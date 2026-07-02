import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const args = parseArgs(process.argv.slice(2));
const system = args.system === 'b' ? 'b' : 'd';
const allFilter = args.all === 'true';
const nameFilter = args.name ? String(args.name).toLowerCase() : '';
const keyFilter = args.key ? String(args.key) : '';
const includeVariants = args.variants !== 'false';
const scale = args.scale || '2';
const batchSize = positiveInteger(args.batchSize, 20);
const delayMs = nonNegativeInteger(args.delayMs, 0);
const token = process.env.FIGMA_ACCESS_TOKEN;

if (!token) {
  throw new Error('FIGMA_ACCESS_TOKEN is required.');
}

if (!allFilter && !nameFilter && !keyFilter) {
  throw new Error('Pass --all, --name <component name>, or --key <component key>.');
}

const root = process.cwd();
const assetsRoot = path.resolve(root, process.env.FIGMA_COMPONENT_ASSETS_DIR || 'figma-component-assets-private');
const mapPath = path.join(assetsRoot, `mappings/${system}-figma-component-key-map.json`);
const map = readJson(mapPath);
const fileKey = map.sourceRegistry?.source?.fileKey;

if (!fileKey) {
  throw new Error(`Missing sourceRegistry.source.fileKey in ${mapPath}.`);
}

const targetGroups = [];
for (const [key, entry] of Object.entries(map.componentSets || {})) {
  const matchesKey = keyFilter && key === keyFilter;
  const matchesName = nameFilter && String(entry.figma?.name || '').toLowerCase() === nameFilter;
  if (!allFilter && !matchesKey && !matchesName) continue;

  const targets = [{ key, nodeId: entry.figma.id, name: entry.figma.name, kind: 'component-set' }];
  if (includeVariants) {
    for (const [variantKey, variant] of Object.entries(entry.components || {})) {
      targets.push({ key: variantKey, nodeId: variant.figma.id, name: variant.figma.name, kind: 'variant' });
    }
  }
  targetGroups.push({
    key,
    name: entry.figma?.name || key,
    kind: 'component-set',
    targets,
  });
}

for (const [key, entry] of Object.entries(map.looseComponents || {})) {
  const matchesKey = keyFilter && key === keyFilter;
  const matchesName = nameFilter && String(entry.figma?.name || '').toLowerCase() === nameFilter;
  if (!allFilter && !matchesKey && !matchesName) continue;
  targetGroups.push({
    key,
    name: entry.figma?.name || key,
    kind: 'loose-component',
    targets: [{ key, nodeId: entry.figma.id, name: entry.figma.name, kind: 'loose-component' }],
  });
}

if (targetGroups.length === 0) {
  throw new Error(`No component matched ${keyFilter || nameFilter || 'all'} in ${mapPath}.`);
}

const previewDir = path.join(assetsRoot, 'previews', system);
fs.mkdirSync(previewDir, { recursive: true });

const indexPath = path.join(previewDir, 'index.json');
const existingIndex = fs.existsSync(indexPath) ? readJson(indexPath) : { system, previews: {} };
const previews = existingIndex.previews && typeof existingIndex.previews === 'object' ? existingIndex.previews : {};

const failures = [];

for (const [groupIndex, group] of targetGroups.entries()) {
  console.log(`${system}: exporting ${groupIndex + 1}/${targetGroups.length} ${group.kind} ${group.name} (${group.targets.length} target(s))`);
  for (const batch of chunk(group.targets, batchSize)) {
    await exportBatch(batch);
  }
  if (delayMs > 0 && groupIndex < targetGroups.length - 1) {
    await sleep(delayMs);
  }
}

fs.writeFileSync(
  indexPath,
  `${JSON.stringify(createIndexPayload(), null, 2)}\n`,
  'utf8',
);

if (failures.length > 0) {
  console.warn(`\n${system}: ${failures.length} preview target(s) failed:`);
  for (const failure of failures) {
    console.warn(`- ${failure.name} (${failure.nodeId}, ${failure.kind}): ${failure.error}`);
  }
  process.exitCode = 1;
}

async function exportBatch(batch, allowFallback = true) {
  const pending = batch.filter((item) => {
    const fileName = `${safeFileName(item.key)}.png`;
    const filePath = path.join(previewDir, fileName);
    if (!fs.existsSync(filePath)) return true;

    const stat = fs.statSync(filePath);
    previews[item.key] = {
      nodeId: item.nodeId,
      fileName,
      kind: item.kind,
      name: item.name,
      scale: Number(scale),
      exportedAt: previews[item.key]?.exportedAt || stat.mtime.toISOString(),
    };
    writeIndex();
    console.log(`${system}: exists ${fileName}, skipped`);
    return false;
  });

  if (pending.length === 0) return;

  const ids = pending.map((item) => item.nodeId).join(',');
  const apiUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=${encodeURIComponent(scale)}`;
  let response;
  try {
    response = await fetch(apiUrl, { headers: { 'X-Figma-Token': token } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (allowFallback && pending.length > 1) {
      console.warn(`${system}: batch request failed, retrying ${pending.length} target(s) one by one: ${message}`);
      for (const item of pending) {
        await exportBatch([item], false);
      }
      return;
    }
    failures.push(...pending.map((item) => ({ ...item, error: `Figma image API request failed: ${message}` })));
    return;
  }

  if (!response.ok) {
    const error = `Figma image API failed: ${response.status} ${response.statusText} ${await response.text()}`;
    if (allowFallback && pending.length > 1) {
      console.warn(`${system}: batch failed, retrying ${pending.length} target(s) one by one.`);
      for (const item of pending) {
        await exportBatch([item], false);
      }
      return;
    }
    failures.push(...pending.map((item) => ({ ...item, error })));
    return;
  }

  const payload = await response.json();
  if (payload.err) {
    const error = `Figma image API returned error: ${payload.err}`;
    if (allowFallback && pending.length > 1) {
      console.warn(`${system}: batch failed, retrying ${pending.length} target(s) one by one.`);
      for (const item of pending) {
        await exportBatch([item], false);
      }
      return;
    }
    failures.push(...pending.map((item) => ({ ...item, error })));
    return;
  }

  for (const item of pending) {
    const imageUrl = payload.images?.[item.nodeId];
    if (!imageUrl) {
      console.warn(`skip ${item.nodeId}: no image URL`);
      continue;
    }

    let image;
    try {
      image = await fetch(imageUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({
        ...item,
        error: `Image download request failed: ${message}`,
      });
      continue;
    }

    if (!image.ok) {
      failures.push({
        ...item,
        error: `Image download failed: ${image.status} ${image.statusText}`,
      });
      continue;
    }

    const bytes = Buffer.from(await image.arrayBuffer());
    const fileName = `${safeFileName(item.key)}.png`;
    fs.writeFileSync(path.join(previewDir, fileName), bytes);
    previews[item.key] = {
      nodeId: item.nodeId,
      fileName,
      kind: item.kind,
      name: item.name,
      scale: Number(scale),
      exportedAt: new Date().toISOString(),
    };
    writeIndex();
    console.log(`${system}: wrote ${fileName} (${bytes.length} bytes)`);
  }
}

function createIndexPayload() {
  return {
    system,
    fileKey,
    generatedAt: new Date().toISOString(),
    previews,
  };
}

function writeIndex() {
  fs.writeFileSync(indexPath, `${JSON.stringify(createIndexPayload(), null, 2)}\n`, 'utf8');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) {
      result[key] = 'true';
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}
