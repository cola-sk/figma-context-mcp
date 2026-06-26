#!/usr/bin/env node
/**
 * Scan a Figma node tree and list every unique INSTANCE component used.
 *
 * Usage:
 *   FIGMA_ACCESS_TOKEN=figd_xxx \
 *     npx tsx scripts/scan-figma-components.ts \
 *     --url https://www.figma.com/design/<fileKey>/<name>?node-id=<node-id>
 *
 * Output (stdout): JSON array of {
 *   componentId, name, variants, occurrenceCount, sampleNodeIds
 * } sorted by occurrenceCount desc.
 *
 * Pass --out <path> to also write the result to a file.
 * Pass --map-skeleton to also emit a mappings/figma-component-map.json skeleton.
 */

import process from 'node:process';
import { writeFileSync } from 'node:fs';

type FigmaNode = {
  id: string;
  type: string;
  name?: string;
  componentId?: string;
  componentProperties?: Record<string, { value: string; type: string }>;
  children?: FigmaNode[];
};

type InstanceEntry = {
  componentId: string;
  name: string;
  variants: Record<string, string>;
  occurrenceCount: number;
  sampleNodeIds: string[];
  sourceType: 'INSTANCE' | 'COMPONENT';
};

function parseArgs(argv: string[]): { url: string; out?: string; mapSkeleton: boolean } {
  let url = '';
  let out: string | undefined;
  let mapSkeleton = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') url = argv[++i];
    else if (a.startsWith('--url=')) url = a.slice('--url='.length);
    else if (a === '--out') out = argv[++i];
    else if (a.startsWith('--out=')) out = a.slice('--out='.length);
    else if (a === '--map-skeleton') mapSkeleton = true;
  }
  if (!url) {
    console.error('Error: --url is required');
    process.exit(1);
  }
  return { url, out, mapSkeleton };
}

function parseFigmaUrl(url: string): { fileKey: string; nodeId: string } {
  const fileMatch = url.match(/figma\.com\/(?:design|file)\/([^/]+)/);
  const nodeMatch = url.match(/node-id=([^&]+)/);
  if (!fileMatch || !nodeMatch) {
    throw new Error('URL must look like https://www.figma.com/design/<fileKey>/<name>?node-id=<id>');
  }
  // Figma URL uses '-' as separator for the two-part node id; API wants ':'
  const nodeId = nodeMatch[1].replace('-', ':');
  return { fileKey: fileMatch[1], nodeId };
}

async function fetchNodeTree(fileKey: string, nodeId: string, token: string): Promise<FigmaNode> {
  const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`;
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) {
    throw new Error(`Figma API ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { nodes: Record<string, { document: FigmaNode }> };
  const entry = json.nodes[nodeId] ?? Object.values(json.nodes)[0];
  if (!entry?.document) {
    throw new Error(`Node ${nodeId} not found in response`);
  }
  return entry.document;
}

function walkInstances(node: FigmaNode, acc: Map<string, InstanceEntry>): void {
  // Collect both INSTANCE (usages on business pages) and COMPONENT (definitions in
  // the component library file). COMPONENT_SET is the parent of a family of COMPONENTs
  // and carries variant *definitions* rather than values, so we recurse into it but
  // don't collect it as a mapping target.
  if ((node.type === 'INSTANCE' || node.type === 'COMPONENT') && node.componentId) {
    const variants: Record<string, string> = {};
    if (node.componentProperties) {
      for (const [k, v] of Object.entries(node.componentProperties)) {
        if (v && typeof v === 'object' && 'value' in v) {
          variants[k] = String(v.value);
        }
      }
    }
    const rawName = node.name ?? '';
    const variantsKey = JSON.stringify(variants);
    const sourceType = node.type === 'COMPONENT' ? 'COMPONENT' : 'INSTANCE';
    const mapKey = `${node.componentId}|${rawName}|${variantsKey}|${sourceType}`;
    const existing = acc.get(mapKey);
    if (existing) {
      existing.occurrenceCount++;
      if (existing.sampleNodeIds.length < 3) existing.sampleNodeIds.push(node.id);
    } else {
      acc.set(mapKey, {
        componentId: node.componentId,
        name: rawName,
        variants,
        occurrenceCount: 1,
        sampleNodeIds: [node.id],
        sourceType,
      });
    }
  }
  if (node.children) {
    for (const c of node.children) walkInstances(c, acc);
  }
}

function buildMapSkeleton(entries: InstanceEntry[]): unknown {
  // Group by componentId + name (collapse variant differences into one entry)
  const byComponent = new Map<string, InstanceEntry[]>();
  for (const e of entries) {
    const key = `${e.componentId}::${e.name}`;
    if (!byComponent.has(key)) byComponent.set(key, []);
    byComponent.get(key)!.push(e);
  }
  const mapping: Record<string, unknown> = {};
  for (const [key, group] of byComponent) {
    const [componentId, name] = key.split('::');
    // Collect all distinct variant property names + values seen
    const variantProps: Record<string, Set<string>> = {};
    for (const e of group) {
      for (const [k, v] of Object.entries(e.variants)) {
        if (!variantProps[k]) variantProps[k] = new Set();
        variantProps[k].add(v);
      }
    }
    const variantToProps: Record<string, Record<string, null>> = {};
    for (const [prop, values] of Object.entries(variantProps)) {
      variantToProps[prop] = {};
      for (const v of values) variantToProps[prop][v] = null;
    }
    mapping[componentId] = {
      tiComponent: null,
      matchBy: 'componentId',
      nameHints: [name],
      variantToProps,
      docs: null,
      notes: null,
    };
  }
  return mapping;
}

async function main(): Promise<void> {
  const { url, out, mapSkeleton } = parseArgs(process.argv.slice(2));
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) {
    console.error('Error: FIGMA_ACCESS_TOKEN env var is required');
    process.exit(1);
  }
  const { fileKey, nodeId } = parseFigmaUrl(url);
  console.error(`Fetching ${fileKey} node ${nodeId}...`);
  const root = await fetchNodeTree(fileKey, nodeId, token);

  const acc = new Map<string, InstanceEntry>();
  walkInstances(root, acc);
  const entries = Array.from(acc.values()).sort((a, b) => b.occurrenceCount - a.occurrenceCount);

  const payload = {
    source: url,
    fileKey,
    nodeId,
    scannedAt: new Date().toISOString(),
    uniqueInstanceVariants: entries.length,
    uniqueComponentIds: new Set(entries.map((e) => e.componentId)).size,
    totalInstances: entries.reduce((s, e) => s + e.occurrenceCount, 0),
    entries,
  };

  const json = JSON.stringify(payload, null, 2);
  if (out) {
    writeFileSync(out, json);
    console.error(`Wrote scan result to ${out}`);
  }
  console.log(json);

  if (mapSkeleton) {
    const skeleton = buildMapSkeleton(entries);
    const skeletonPath = 'mappings/figma-component-map.json';
    writeFileSync(skeletonPath, JSON.stringify(skeleton, null, 2) + '\n');
    console.error(`Wrote mapping skeleton to ${skeletonPath}`);
  }
}

main().catch((err) => {
  console.error('Scan failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
