import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const system = args.system === 'b' ? 'b' : 'd';
const nameFilter = args.name ? String(args.name).toLowerCase() : '';
const keyFilter = args.key ? String(args.key) : '';
const includeVariants = args.variants !== 'false';
const scale = args.scale || '2';
const token = process.env.FIGMA_ACCESS_TOKEN;

if (!token) {
  throw new Error('FIGMA_ACCESS_TOKEN is required.');
}

if (!nameFilter && !keyFilter) {
  throw new Error('Pass --name <component name> or --key <component key>.');
}

const root = process.cwd();
const mapPath = path.join(root, `assets/mappings/${system}-figma-component-key-map.json`);
const map = readJson(mapPath);
const fileKey = map.sourceRegistry?.source?.fileKey;

if (!fileKey) {
  throw new Error(`Missing sourceRegistry.source.fileKey in ${mapPath}.`);
}

const targets = [];
for (const [key, entry] of Object.entries(map.componentSets || {})) {
  const matchesKey = keyFilter && key === keyFilter;
  const matchesName = nameFilter && String(entry.figma?.name || '').toLowerCase() === nameFilter;
  if (!matchesKey && !matchesName) continue;

  targets.push({ key, nodeId: entry.figma.id, name: entry.figma.name, kind: 'component-set' });
  if (includeVariants) {
    for (const [variantKey, variant] of Object.entries(entry.components || {})) {
      targets.push({ key: variantKey, nodeId: variant.figma.id, name: variant.figma.name, kind: 'variant' });
    }
  }
}

for (const [key, entry] of Object.entries(map.looseComponents || {})) {
  const matchesKey = keyFilter && key === keyFilter;
  const matchesName = nameFilter && String(entry.figma?.name || '').toLowerCase() === nameFilter;
  if (!matchesKey && !matchesName) continue;
  targets.push({ key, nodeId: entry.figma.id, name: entry.figma.name, kind: 'loose-component' });
}

if (targets.length === 0) {
  throw new Error(`No component matched ${keyFilter || nameFilter} in ${mapPath}.`);
}

const publicDir = path.join(root, 'app/public/previews', system);
fs.mkdirSync(publicDir, { recursive: true });

const indexPath = path.join(publicDir, 'index.json');
const existingIndex = fs.existsSync(indexPath) ? readJson(indexPath) : { system, previews: {} };
const previews = existingIndex.previews && typeof existingIndex.previews === 'object' ? existingIndex.previews : {};

for (const batch of chunk(targets, 20)) {
  const ids = batch.map((item) => item.nodeId).join(',');
  const apiUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=${encodeURIComponent(scale)}`;
  const response = await fetch(apiUrl, { headers: { 'X-Figma-Token': token } });
  if (!response.ok) {
    throw new Error(`Figma image API failed: ${response.status} ${response.statusText} ${await response.text()}`);
  }

  const payload = await response.json();
  if (payload.err) {
    throw new Error(`Figma image API returned error: ${payload.err}`);
  }

  for (const item of batch) {
    const imageUrl = payload.images?.[item.nodeId];
    if (!imageUrl) {
      console.warn(`skip ${item.nodeId}: no image URL`);
      continue;
    }

    const image = await fetch(imageUrl);
    if (!image.ok) {
      throw new Error(`Image download failed for ${item.nodeId}: ${image.status} ${image.statusText}`);
    }

    const bytes = Buffer.from(await image.arrayBuffer());
    const fileName = `${safeFileName(item.key)}.png`;
    fs.writeFileSync(path.join(publicDir, fileName), bytes);
    previews[item.key] = {
      nodeId: item.nodeId,
      fileName,
      kind: item.kind,
      name: item.name,
      scale: Number(scale),
      exportedAt: new Date().toISOString(),
    };
    console.log(`${system}: wrote ${fileName} (${bytes.length} bytes)`);
  }
}

fs.writeFileSync(
  indexPath,
  `${JSON.stringify({ system, fileKey, generatedAt: new Date().toISOString(), previews }, null, 2)}\n`,
  'utf8',
);

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

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}
