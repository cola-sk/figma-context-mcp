import fs from 'node:fs';
import path from 'node:path';
import { normalizeTargetLibrary, type TargetLibrary } from './mapping-constants';

export type MappingStatus = 'mapped' | 'unresolved' | 'internal';
export type MappingKind = 'component-set' | 'loose-component';
export type VariantMode = 'inherit' | 'override' | 'unresolved' | 'internal';
export type MapSystem = 'd' | 'b';
type VariantStatus = 'mapped-via-component-set' | 'mapped-override' | 'unresolved';

type Target = {
  library?: string;
  component?: string;
  props?: Record<string, string>;
  docs?: string | null;
  fallbackReason?: string;
  evidence?: string[];
} | null;

type ComponentSetEntry = {
  figma: {
    id: string;
    key: string;
    name: string;
    type: string;
    page?: string;
    path?: string;
    componentCount?: number;
    componentPropertyDefinitions?: Record<string, unknown>;
  };
  status: MappingStatus;
  target: Target;
  reason?: string;
  variantToPropsStatus?: string;
  variantToPropsReason?: string;
  components?: Record<string, ComponentVariantEntry>;
};

type ComponentVariantEntry = {
  figma: {
    id: string;
    key: string;
    name: string;
    type: string;
    page?: string;
    path?: string;
    componentSetId?: string;
    componentSetKey?: string;
    componentSetName?: string;
    variantProperties?: Record<string, string>;
  };
  status?: VariantStatus | string;
  target?: Target;
  targetRef?: string | null;
  reason?: string;
};

type LooseComponentEntry = {
  figma: {
    id: string;
    key: string;
    name: string;
    type: string;
    page?: string;
    path?: string;
  };
  status: MappingStatus;
  target: Target;
  reason?: string;
  variantToPropsStatus?: string;
};

export type ComponentMap = {
  schemaVersion: string;
  generatedAt?: string;
  sourceRegistry?: unknown;
  mappingPolicy?: unknown;
  stats: Record<string, number>;
  componentSets: Record<string, ComponentSetEntry>;
  looseComponents: Record<string, LooseComponentEntry>;
};

export const mapSystems: Array<{ id: MapSystem; label: string; mapFile: string }> = [
  { id: 'd', label: 'D 端', mapFile: 'd-figma-component-key-map.json' },
  { id: 'b', label: 'B 端', mapFile: 'b-figma-component-key-map.json' },
];

export type MapRow = {
  rowId: string;
  kind: MappingKind;
  key: string;
  figmaId: string;
  previewUrl?: string;
  name: string;
  page: string;
  status: MappingStatus;
  targetLibrary: string;
  targetComponent: string;
  targetProps: Record<string, string>;
  reason: string;
  evidence: string[];
  variantCount: number;
  variants: MapVariant[];
  raw: unknown;
};

export type MapVariant = {
  key: string;
  figmaId: string;
  previewUrl?: string;
  name: string;
  status: string;
  mode: VariantMode;
  targetLibrary: string;
  targetComponent: string;
  targetProps: Record<string, string>;
  reason: string;
  variantProperties: Record<string, string>;
};

export type MapViewData = {
  system: MapSystem;
  systemLabel: string;
  mapFile: string;
  schemaVersion: string;
  generatedAt?: string;
  stats: Record<string, number>;
  rows: MapRow[];
  pages: string[];
  targetComponents: string[];
};

export function normalizeMapSystem(value: unknown): MapSystem {
  return value === 'b' ? 'b' : 'd';
}

export function getMapSystemMeta(system: MapSystem) {
  return mapSystems.find((item) => item.id === system) ?? mapSystems[0];
}

export function getComponentAssetsRoot() {
  if (process.env.FIGMA_COMPONENT_ASSETS_DIR) {
    return path.resolve(process.env.FIGMA_COMPONENT_ASSETS_DIR);
  }

  return path.join(process.cwd(), '..', 'figma-component-assets-private');
}

export function getMapPath(system: MapSystem = 'd') {
  return path.join(getComponentAssetsRoot(), 'mappings', getMapSystemMeta(system).mapFile);
}

function asText(value: unknown, fallback = '-') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function targetLabel(target: Target, field: 'library' | 'component') {
  if (!target || typeof target[field] !== 'string' || !target[field]) return '-';
  if (field === 'library') return normalizeTargetLibrary(target[field]) ?? target[field];
  return target[field];
}

function targetProps(target: Target): Record<string, string> {
  if (!target || typeof target.props !== 'object' || !target.props) return {};
  return target.props;
}

function optionalTargetLabel(target: Target | undefined, field: 'library' | 'component') {
  return targetLabel(target ?? null, field);
}

function optionalTargetProps(target: Target | undefined): Record<string, string> {
  return targetProps(target ?? null);
}

function getEvidence(target: Target) {
  return target && Array.isArray(target.evidence) ? target.evidence.filter((item): item is string => typeof item === 'string') : [];
}

function loadPreviewIndex(system: MapSystem): Record<string, string> {
  const indexPath = path.join(getComponentAssetsRoot(), 'previews', system, 'index.json');
  if (!fs.existsSync(indexPath)) return {};

  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { previews?: Record<string, { fileName?: string }> };
    return Object.fromEntries(
      Object.entries(index.previews || {})
        .filter(([, preview]) => typeof preview.fileName === 'string' && preview.fileName)
        .map(([key, preview]) => [key, `/previews/${system}/${preview.fileName}`]),
    );
  } catch {
    return {};
  }
}

export function loadComponentMap(system: MapSystem = 'd'): ComponentMap {
  const mapPath = getMapPath(system);
  const raw = fs.readFileSync(mapPath, 'utf8');
  return JSON.parse(raw) as ComponentMap;
}

export function saveComponentMap(map: ComponentMap, system: MapSystem = 'd') {
  fs.writeFileSync(getMapPath(system), `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

function getVariantCount(entry: ComponentSetEntry) {
  return entry.figma.componentCount ?? Object.keys(entry.components || {}).length;
}

function getVariantMode(variant: ComponentVariantEntry): VariantMode {
  if (variant.status === 'mapped-override') return 'override';
  if (variant.status === 'unresolved') return 'unresolved';
  if (variant.status === 'internal') return 'internal';
  return 'inherit';
}

function isVariantMapped(variant: ComponentVariantEntry, componentSet: ComponentSetEntry) {
  if (variant.status === 'mapped-override') return Boolean(optionalTargetLabel(variant.target, 'component') !== '-');
  if (variant.status === 'unresolved' || variant.status === 'internal') return false;
  return componentSet.status === 'mapped';
}

function recomputeStats(map: ComponentMap) {
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
  const componentVariantCount = componentSets.reduce((total, entry) => total + getVariantCount(entry), 0);

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

export function updateMapEntry({
  map,
  kind,
  key,
  status,
  target,
}: {
  map: ComponentMap;
  kind: MappingKind;
  key: string;
  status: MappingStatus;
  target?: { library: TargetLibrary; component: string; props?: Record<string, string> } | null;
}) {
  const entry = kind === 'component-set' ? map.componentSets?.[key] : map.looseComponents?.[key];
  if (!entry) {
    throw new Error(`Mapping entry not found: ${kind}:${key}`);
  }

  if (status === 'mapped') {
    if (!target?.component.trim()) {
      throw new Error('Target component is required when status is mapped.');
    }

    entry.status = 'mapped';
    entry.target = {
      library: target.library,
      component: target.component.trim(),
      props: target.props && Object.keys(target.props).length > 0 ? target.props : undefined,
      docs: null,
      evidence: ['Manual mapping saved in Component Map Viewer.'],
    };
    entry.reason = 'Mapped manually in Component Map Viewer.';

    if (kind === 'component-set') {
      const componentSet = entry as ComponentSetEntry;
      Object.values(componentSet.components || {}).forEach((component) => {
        if (component.status === 'mapped-override') return;
        Object.assign(component, {
          status: 'mapped-via-component-set',
          targetRef: `componentSets.${key}.target`,
          reason: 'Concrete variant inherits the manually saved component-set mapping.',
        });
      });
    }
  } else if (status === 'internal') {
    entry.status = 'internal';
    entry.target = null;
    entry.reason = 'Marked as internal subcomponent manually in Component Map Viewer.';

    if (kind === 'component-set') {
      const componentSet = entry as ComponentSetEntry;
      Object.values(componentSet.components || {}).forEach((component) => {
        if (component.status === 'mapped-override') return;
        Object.assign(component, {
          status: 'internal',
          targetRef: null,
          reason: 'Parent component set was marked as internal subcomponent manually.',
        });
      });
    }
  } else {
    entry.status = 'unresolved';
    entry.target = null;
    entry.reason = 'Marked unresolved manually in Component Map Viewer. Do not infer a replacement component.';

    if (kind === 'component-set') {
      const componentSet = entry as ComponentSetEntry;
      Object.values(componentSet.components || {}).forEach((component) => {
        if (component.status === 'mapped-override') return;
        Object.assign(component, {
          status: 'unresolved',
          targetRef: null,
          reason: 'Parent component set was marked unresolved manually.',
        });
      });
    }
  }

  recomputeStats(map);
}

export function updateVariantEntry({
  map,
  componentSetKey,
  variantKey,
  mode,
  target,
}: {
  map: ComponentMap;
  componentSetKey: string;
  variantKey: string;
  mode: VariantMode;
  target?: { library: TargetLibrary; component: string; props?: Record<string, string> } | null;
}) {
  const componentSet = map.componentSets?.[componentSetKey];
  const variant = componentSet?.components?.[variantKey];
  if (!componentSet || !variant) {
    throw new Error(`Variant entry not found: ${componentSetKey}:${variantKey}`);
  }

  if (mode === 'override') {
    if (!target?.component.trim()) {
      throw new Error('Target component is required when variant mode is override.');
    }

    variant.status = 'mapped-override';
    variant.target = {
      library: target.library,
      component: target.component.trim(),
      props: target.props && Object.keys(target.props).length > 0 ? target.props : undefined,
      docs: null,
      evidence: ['Manual variant override saved in Component Map Viewer.'],
    };
    variant.targetRef = null;
    variant.reason = 'Variant target overrides its component-set mapping.';
  } else if (mode === 'inherit') {
    delete variant.target;
    variant.targetRef = componentSet.status === 'mapped' ? `componentSets.${componentSetKey}.target` : null;
    variant.status = componentSet.status === 'mapped' ? 'mapped-via-component-set' : componentSet.status === 'internal' ? 'internal' : 'unresolved';
    variant.reason =
      componentSet.status === 'mapped'
        ? 'Concrete variant inherits the component-set mapping.'
        : componentSet.status === 'internal'
          ? 'Concrete variant inherits an internal component-set status.'
          : 'Concrete variant inherits an unresolved component-set mapping.';
  } else if (mode === 'internal') {
    variant.status = 'internal';
    variant.target = null;
    variant.targetRef = null;
    variant.reason = 'Marked as internal subcomponent manually in Component Map Viewer.';
  } else {
    variant.status = 'unresolved';
    variant.target = null;
    variant.targetRef = null;
    variant.reason = 'Marked unresolved manually in Component Map Viewer. Do not infer a replacement component.';
  }

  recomputeStats(map);
}

function mapVariant(variant: ComponentVariantEntry, componentSet: ComponentSetEntry, previewUrls: Record<string, string>): MapVariant {
  const mode = getVariantMode(variant);
  const target = mode === 'override' ? variant.target : mode === 'inherit' ? componentSet.target : null;

  return {
    key: variant.figma.key,
    figmaId: variant.figma.id,
    previewUrl: previewUrls[variant.figma.key],
    name: variant.figma.name,
    status: asText(variant.status),
    mode,
    targetLibrary: optionalTargetLabel(target, 'library'),
    targetComponent: optionalTargetLabel(target, 'component'),
    targetProps: optionalTargetProps(target),
    reason: asText(variant.reason),
    variantProperties: variant.figma.variantProperties ?? {},
  };
}

export function mapToViewData(parsed: ComponentMap, system: MapSystem = 'd'): MapViewData {
  const meta = getMapSystemMeta(system);
  const previewUrls = loadPreviewIndex(system);
  const componentSetRows: MapRow[] = Object.entries(parsed.componentSets || {}).map(([key, entry]) => ({
    rowId: `component-set:${key}`,
    kind: 'component-set',
    key,
    figmaId: entry.figma.id,
    previewUrl: previewUrls[key],
    name: entry.figma.name,
    page: asText(entry.figma.page),
    status: entry.status,
    targetLibrary: targetLabel(entry.target, 'library'),
    targetComponent: targetLabel(entry.target, 'component'),
    targetProps: targetProps(entry.target),
    reason: asText(entry.reason),
    evidence: getEvidence(entry.target),
    variantCount: entry.figma.componentCount ?? Object.keys(entry.components || {}).length,
    variants: Object.values(entry.components || {}).map((variant) => mapVariant(variant, entry, previewUrls)),
    raw: entry,
  }));

  const looseRows: MapRow[] = Object.entries(parsed.looseComponents || {}).map(([key, entry]) => ({
    rowId: `loose-component:${key}`,
    kind: 'loose-component',
    key,
    figmaId: entry.figma.id,
    previewUrl: previewUrls[key],
    name: entry.figma.name,
    page: asText(entry.figma.page),
    status: entry.status,
    targetLibrary: targetLabel(entry.target, 'library'),
    targetComponent: targetLabel(entry.target, 'component'),
    targetProps: targetProps(entry.target),
    reason: asText(entry.reason),
    evidence: getEvidence(entry.target),
    variantCount: 1,
    variants: [],
    raw: entry,
  }));

  const rows = [...componentSetRows, ...looseRows].sort((a, b) => {
    const page = a.page.localeCompare(b.page, 'zh-CN');
    if (page !== 0) return page;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return {
    system,
    systemLabel: meta.label,
    mapFile: meta.mapFile,
    schemaVersion: parsed.schemaVersion,
    generatedAt: parsed.generatedAt,
    stats: parsed.stats,
    rows,
    pages: Array.from(new Set(rows.map((row) => row.page))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    targetComponents: Array.from(
      new Set(
        rows
          .flatMap((row) => [row.targetComponent, ...row.variants.map((variant) => variant.targetComponent)])
          .filter((item) => item !== '-'),
      ),
    ).sort(),
  };
}

export function loadMapViewData(system: MapSystem = 'd'): MapViewData {
  return mapToViewData(loadComponentMap(system), system);
}
