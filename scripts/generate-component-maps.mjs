import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mappingsDir = path.join(root, 'assets/mappings');
const seedMapPath = path.join(mappingsDir, 'figma-component-key-map.json');

const systems = [
  {
    id: 'd',
    registryDir: 'assets/d-components',
    output: 'assets/mappings/d-figma-component-key-map.json',
  },
  {
    id: 'b',
    registryDir: 'assets/b-components',
    output: 'assets/mappings/b-figma-component-key-map.json',
  },
];

for (const system of systems) {
  const registry = readJson(path.join(root, system.registryDir, 'all.json'));
  const registryIndex = readJson(path.join(root, system.registryDir, 'index.json'));
  const outputPath = path.join(root, system.output);
  const seedMap = fs.existsSync(outputPath) ? readJson(outputPath) : readJson(seedMapPath);
  const nextMap = buildMap({ system, registry, registryIndex, seedMap });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(nextMap, null, 2)}\n`, 'utf8');
  console.log(`${system.id}: wrote ${system.output}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildMap({ system, registry, registryIndex, seedMap }) {
  const seedIndex = createSeedIndex(seedMap);
  const componentSets = {};
  const looseComponents = {};

  for (const set of registry.componentSets || []) {
    const inherited = findSeedEntry(seedIndex.componentSets, set);
    componentSets[set.key] = createComponentSetEntry(set, inherited, seedIndex);
  }

  for (const component of registry.looseComponents || []) {
    const inherited = findSeedEntry(seedIndex.looseComponents, component);
    looseComponents[component.key] = createLooseComponentEntry(component, inherited);
  }

  const map = {
    schemaVersion: seedMap.schemaVersion || 'figma-component-key-map/v1',
    generatedAt: new Date().toISOString(),
    sourceRegistry: {
      directory: system.registryDir.replace(/^assets\//, ''),
      schemaVersion: registry.schemaVersion,
      source: registry.source,
      files: (registryIndex.files || []).map((file) => ({
        fileName: file.fileName,
        page: normalizePage(file.page),
        exportedAt: registryIndex.exportedAt,
        stats: file.stats,
      })),
    },
    mappingPolicy: seedMap.mappingPolicy,
    stats: {},
    componentSets,
    looseComponents,
  };

  recomputeStats(map);
  map.stats.sourcePageFileCount = (registryIndex.files || []).length;
  return map;
}

function createSeedIndex(map) {
  const componentSets = createEntryIndex(Object.values(map.componentSets || {}));
  const looseComponents = createEntryIndex(Object.values(map.looseComponents || {}));
  const variants = createEntryIndex(
    Object.values(map.componentSets || {}).flatMap((set) => Object.values(set.components || {})),
  );

  return {
    componentSets,
    looseComponents,
    variants,
  };
}

function createEntryIndex(entries) {
  const byKey = new Map();
  const byId = new Map();
  const byName = new Map();

  for (const entry of entries) {
    const figma = entry.figma || entry;
    if (figma.key) byKey.set(figma.key, entry);
    if (figma.id) byId.set(figma.id, entry);
    byName.set(nameSignature(figma), entry);
  }

  return { byKey, byId, byName };
}

function findSeedEntry(index, item) {
  return index.byKey.get(item.key) || index.byId.get(item.id) || index.byName.get(nameSignature(item));
}

function createComponentSetEntry(set, inherited, seedIndex) {
  const status = normalizeStatus(inherited?.status);
  const target = status === 'mapped' ? cloneTarget(inherited?.target) : null;
  const components = {};

  for (const component of set.components || []) {
    const inheritedVariant = findSeedEntry(seedIndex.variants, component);
    components[component.key] = createVariantEntry(component, set.key, status, inheritedVariant);
  }

  return compactObject({
    figma: createComponentSetFigma(set),
    status,
    target,
    reason: inherited?.reason || defaultEntryReason(status),
    variantToPropsStatus: inherited?.variantToPropsStatus,
    variantToPropsReason: inherited?.variantToPropsReason,
    components,
  });
}

function createVariantEntry(component, componentSetKey, parentStatus, inherited) {
  const inheritedStatus = inherited?.status;
  const status = typeof inheritedStatus === 'string'
    ? inheritedStatus
    : parentStatus === 'mapped'
      ? 'mapped-via-component-set'
      : parentStatus === 'internal'
        ? 'internal'
        : 'unresolved';

  const isOverride = status === 'mapped-override';
  const isInheritedMapped = status === 'mapped-via-component-set';

  return compactObject({
    figma: createVariantFigma(component),
    status,
    target: isOverride ? cloneTarget(inherited?.target) : status === 'internal' || status === 'unresolved' ? null : undefined,
    targetRef: isInheritedMapped ? `componentSets.${componentSetKey}.target` : isOverride ? null : inherited?.targetRef === null ? null : undefined,
    reason: inherited?.reason || defaultVariantReason(status, parentStatus),
  });
}

function createLooseComponentEntry(component, inherited) {
  const status = normalizeStatus(inherited?.status);
  return compactObject({
    figma: createLooseFigma(component),
    status,
    target: status === 'mapped' ? cloneTarget(inherited?.target) : null,
    reason: inherited?.reason || defaultEntryReason(status),
    variantToPropsStatus: inherited?.variantToPropsStatus,
  });
}

function createComponentSetFigma(set) {
  return compactObject({
    id: set.id,
    key: set.key,
    name: set.name,
    type: set.type,
    description: set.description,
    page: normalizePage(set.page),
    path: set.path,
    componentCount: Array.isArray(set.components) ? set.components.length : undefined,
    componentPropertyDefinitions: set.componentPropertyDefinitions,
  });
}

function createVariantFigma(component) {
  return compactObject({
    id: component.id,
    key: component.key,
    name: component.name,
    type: component.type,
    description: component.description,
    page: normalizePage(component.page),
    path: component.path,
    componentSetId: component.componentSetId,
    componentSetKey: component.componentSetKey,
    componentSetName: component.componentSetName,
    variantProperties: component.variantProperties || component.variantPropertiesFromName,
  });
}

function createLooseFigma(component) {
  return compactObject({
    id: component.id,
    key: component.key,
    name: component.name,
    type: component.type,
    description: component.description,
    page: normalizePage(component.page),
    path: component.path,
  });
}

function normalizeStatus(status) {
  return status === 'mapped' || status === 'internal' ? status : 'unresolved';
}

function defaultEntryReason(status) {
  if (status === 'mapped') return 'Mapping carried over from previous Component Map Viewer data.';
  if (status === 'internal') return 'Marked as internal subcomponent in previous Component Map Viewer data.';
  return 'Generated from Figma registry export; mapping not reviewed yet.';
}

function defaultVariantReason(status, parentStatus) {
  if (status === 'mapped-override') return 'Variant target overrides its component-set mapping.';
  if (status === 'mapped-via-component-set') return 'Concrete variant inherits the component-set mapping.';
  if (status === 'internal' && parentStatus === 'internal') return 'Concrete variant inherits an internal component-set status.';
  if (status === 'internal') return 'Marked as internal subcomponent in previous Component Map Viewer data.';
  return 'Concrete variant inherits an unresolved component-set mapping.';
}

function cloneTarget(target) {
  if (!target || typeof target !== 'object') return null;
  return JSON.parse(JSON.stringify(target));
}

function normalizePage(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : undefined;
}

function nameSignature(figma) {
  return `${normalizePage(figma.page) || ''}::${String(figma.name || '').trim()}`;
}

function recomputeStats(map) {
  const componentSets = Object.values(map.componentSets || {});
  const looseComponents = Object.values(map.looseComponents || {});
  const mappedComponentCount = componentSets.reduce(
    (total, entry) => total + Object.values(entry.components || {}).filter((variant) => isVariantMapped(variant, entry)).length,
    0,
  );
  const internalComponentCount = componentSets.reduce(
    (total, entry) => total + Object.values(entry.components || {}).filter((variant) => variant.status === 'internal').length,
    0,
  );
  const componentVariantCount = componentSets.reduce((total, entry) => total + (entry.figma.componentCount || Object.keys(entry.components || {}).length), 0);

  map.stats = {
    ...map.stats,
    componentSetCount: componentSets.length,
    mappedComponentSetCount: componentSets.filter((entry) => entry.status === 'mapped').length,
    unresolvedComponentSetCount: componentSets.filter((entry) => entry.status === 'unresolved').length,
    internalComponentSetCount: componentSets.filter((entry) => entry.status === 'internal').length,
    looseComponentCount: looseComponents.length,
    mappedLooseComponentCount: looseComponents.filter((entry) => entry.status === 'mapped').length,
    unresolvedLooseComponentCount: looseComponents.filter((entry) => entry.status === 'unresolved').length,
    internalLooseComponentCount: looseComponents.filter((entry) => entry.status === 'internal').length,
    mappedComponentCount,
    internalComponentCount,
    unresolvedComponentCount: componentVariantCount - mappedComponentCount - internalComponentCount,
    componentVariantCount,
    totalExportedComponentCount: componentVariantCount + looseComponents.length,
  };
}

function isVariantMapped(variant, componentSet) {
  if (variant.status === 'mapped-override') return Boolean(variant.target?.component);
  if (variant.status === 'unresolved' || variant.status === 'internal') return false;
  return componentSet.status === 'mapped';
}

function compactObject(object) {
  if (!object || typeof object !== 'object') return object;
  const result = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    result[key] = value;
  }
  return result;
}
