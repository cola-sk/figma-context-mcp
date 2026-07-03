import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..');

export type MapSource = 'b' | 'd' | 'none' | 'auto';
export type TiComponentStatus = 'mapped' | 'unmapped' | 'internal';
export type TiComponentSourceStatus = 'mapped' | 'unresolved' | 'internal' | 'not-found';
export type TiComponentVariantProps = Record<string, string> | null;
export type ComponentMapResolutionStatus =
  | 'loaded'
  | 'disabled'
  | 'auto-unmatched'
  | 'missing'
  | 'invalid';

export interface ComponentMapConfig {
  source: MapSource;
  overridePath?: string | null;
  inject: boolean;
}

export interface ProjectConfig {
  componentMap: ComponentMapConfig;
}

export interface ProjectConfigContext {
  config: ProjectConfig;
  configPath: string | null;
  projectRoot: string;
  warnings: string[];
}

export interface TiComponentHint {
  library: string | null;
  component: string | null;
  status: TiComponentStatus;
  sourceStatus: TiComponentSourceStatus;
  source: 'b' | 'd' | 'override';
  figmaName?: string;
  figmaKey?: string;
  evidence: string[];
  fallbackReason: string | null;
  variantProps: TiComponentVariantProps;
  hint: string;
}

export interface ComponentMapSummary {
  source: 'b' | 'd' | 'override';
  fileKey: string | null;
  fileName: string | null;
  mapped: number;
  unmapped: number;
  internal: number;
  policy: string;
}

export interface ComponentMapResolution {
  status: ComponentMapResolutionStatus;
  componentMap: ComponentMap | null;
  configContext: ProjectConfigContext;
  requestedSource: MapSource | 'override';
  mapPath: string | null;
  message: string;
}

interface RawComponentMap {
  sourceRegistry?: {
    source?: {
      fileName?: unknown;
      fileKey?: unknown;
    };
  };
  mappingPolicy?: {
    strictNoGuessing?: unknown;
    unresolvedBehavior?: unknown;
  };
  stats?: {
    mappedComponentSetCount?: unknown;
    unresolvedComponentSetCount?: unknown;
    internalComponentSetCount?: unknown;
  };
  componentSets?: Record<string, RawMapEntry>;
  looseComponents?: Record<string, RawMapEntry>;
}

interface RawMapEntry {
  figma?: {
    key?: unknown;
    name?: unknown;
  };
  status?: unknown;
  target?: RawMapTarget;
  reason?: unknown;
  components?: Record<string, RawComponentVariant>;
}

interface RawMapTarget {
  library?: unknown;
  component?: unknown;
  props?: unknown;
  fallbackReason?: unknown;
  evidence?: unknown;
}

interface RawComponentVariant {
  figma?: {
    key?: unknown;
    name?: unknown;
    componentSetKey?: unknown;
  };
  status?: unknown;
  target?: RawMapTarget | null;
  targetRef?: unknown;
  reason?: unknown;
}

const validSources = new Set<MapSource>(['b', 'd', 'none', 'auto']);

const defaultConfig: ProjectConfig = {
  componentMap: {
    source: 'auto',
    overridePath: null,
    inject: true,
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const asStringRecord = (value: unknown): Record<string, string> | null => {
  if (!isRecord(value)) return null;

  const entries = Object.entries(value).filter((entry): entry is [string, string] =>
    typeof entry[0] === 'string' && entry[0].length > 0 && typeof entry[1] === 'string',
  );

  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

const countEntriesByStatus = (entries: Record<string, RawMapEntry> | undefined, status: string): number =>
  Object.values(entries ?? {}).filter((entry) => entry.status === status).length;

const normalizeProjectConfig = (rawConfig: unknown): { config: ProjectConfig; warnings: string[] } => {
  const warnings: string[] = [];
  const rawComponentMap = isRecord(rawConfig) && isRecord(rawConfig.componentMap)
    ? rawConfig.componentMap
    : {};

  const rawSource = rawComponentMap.source;
  const source = typeof rawSource === 'string' && validSources.has(rawSource as MapSource)
    ? rawSource as MapSource
    : 'auto';

  if (rawSource !== undefined && source === 'auto' && rawSource !== 'auto') {
    warnings.push(`Invalid componentMap.source "${String(rawSource)}"; using "auto".`);
  }

  const overridePath = typeof rawComponentMap.overridePath === 'string' && rawComponentMap.overridePath.length > 0
    ? rawComponentMap.overridePath
    : null;

  return {
    config: {
      componentMap: {
        source,
        overridePath,
        inject: rawComponentMap.inject !== false,
      },
    },
    warnings,
  };
};

const resolveAssetsRoot = (cwd: string): string => {
  if (process.env.FIGMA_COMPONENT_ASSETS_DIR) {
    return isAbsolute(process.env.FIGMA_COMPONENT_ASSETS_DIR)
      ? process.env.FIGMA_COMPONENT_ASSETS_DIR
      : resolve(cwd, process.env.FIGMA_COMPONENT_ASSETS_DIR);
  }

  const cwdAssetsRoot = resolve(cwd, 'figma-component-assets-private');
  if (existsSync(cwdAssetsRoot)) {
    return cwdAssetsRoot;
  }

  return join(packageRoot, 'figma-component-assets-private');
};

const resolveBuiltInMapPath = (source: 'b' | 'd', cwd: string): string =>
  join(resolveAssetsRoot(cwd), 'mappings', `${source}-figma-component-key-map.json`);

const resolveOverridePath = (overridePath: string, projectRoot: string): string =>
  isAbsolute(overridePath) ? overridePath : resolve(projectRoot, overridePath);

const readRawMap = (mapPath: string): RawComponentMap => {
  const raw = JSON.parse(readFileSync(mapPath, 'utf-8')) as unknown;
  if (!isRecord(raw)) {
    throw new Error('Component map root must be an object.');
  }
  return raw as RawComponentMap;
};

const getSourceFileKey = (mapPath: string): string | null => {
  try {
    return asString(readRawMap(mapPath).sourceRegistry?.source?.fileKey);
  } catch {
    return null;
  }
};

export class ComponentMap {
  private readonly setEntries = new Map<string, RawMapEntry>();
  private readonly variantEntries = new Map<string, { variant: RawComponentVariant; parent: RawMapEntry }>();
  private readonly componentKeyToSetKey = new Map<string, string>();
  private readonly looseEntries = new Map<string, RawMapEntry>();

  private constructor(
    private readonly rawMap: RawComponentMap,
    private readonly source: 'b' | 'd' | 'override',
    public readonly mapPath: string,
  ) {
    for (const [setKey, entry] of Object.entries(rawMap.componentSets ?? {})) {
      this.setEntries.set(setKey, entry);

      for (const [componentKey, variant] of Object.entries(entry.components ?? {})) {
        this.componentKeyToSetKey.set(componentKey, setKey);
        this.variantEntries.set(componentKey, { variant, parent: entry });

        const figmaKey = asString(variant.figma?.key);
        if (figmaKey) {
          this.componentKeyToSetKey.set(figmaKey, setKey);
          this.variantEntries.set(figmaKey, { variant, parent: entry });
        }

        const componentSetKey = asString(variant.figma?.componentSetKey);
        if (componentSetKey) {
          this.setEntries.set(componentSetKey, entry);
        }
      }
    }

    for (const [componentKey, entry] of Object.entries(rawMap.looseComponents ?? {})) {
      this.looseEntries.set(componentKey, entry);
      const figmaKey = asString(entry.figma?.key);
      if (figmaKey) {
        this.looseEntries.set(figmaKey, entry);
      }
    }
  }

  static findProjectConfig(candidates: string | string[], maxDepth = 5): ProjectConfigContext {
    const candidateList = (Array.isArray(candidates) ? candidates : [candidates])
      .filter((candidate): candidate is string => Boolean(candidate));
    const seen = new Set<string>();
    const fallbackRoot = candidateList.find((candidate) => existsSync(candidate)) ?? resolve(candidateList[0] ?? process.cwd());

    for (const start of candidateList) {
      let current = resolve(start);

      for (let depth = 0; depth <= maxDepth; depth += 1) {
        if (seen.has(current)) {
          break;
        }
        seen.add(current);

        const configPath = join(current, '.figma-context-mcp.json');
        if (existsSync(configPath)) {
          try {
            const rawConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
            const { config, warnings } = normalizeProjectConfig(rawConfig);
            return {
              config,
              configPath,
              projectRoot: current,
              warnings,
            };
          } catch (error) {
            return {
              config: defaultConfig,
              configPath,
              projectRoot: current,
              warnings: [`Failed to parse .figma-context-mcp.json: ${error instanceof Error ? error.message : String(error)}`],
            };
          }
        }

        const parent = dirname(current);
        if (parent === current) {
          break;
        }
        current = parent;
      }
    }

    return {
      config: defaultConfig,
      configPath: null,
      projectRoot: fallbackRoot,
      warnings: [],
    };
  }

  static resolveForRequest(options: {
    cwd: string | string[];
    requestFileKey?: string | null;
  }): ComponentMapResolution {
    const configContext = ComponentMap.findProjectConfig(options.cwd);
    const componentMapConfig = configContext.config.componentMap;

    if (!componentMapConfig.inject || componentMapConfig.source === 'none') {
      return {
        status: 'disabled',
        componentMap: null,
        configContext,
        requestedSource: componentMapConfig.source,
        mapPath: null,
        message: 'Component map injection is disabled by project configuration.',
      };
    }

    if (componentMapConfig.overridePath) {
      const mapPath = resolveOverridePath(componentMapConfig.overridePath, configContext.projectRoot);
      return ComponentMap.loadResolvedMap(mapPath, 'override', configContext, 'override');
    }

    if (componentMapConfig.source === 'b' || componentMapConfig.source === 'd') {
      const mapPath = resolveBuiltInMapPath(componentMapConfig.source, configContext.projectRoot);
      return ComponentMap.loadResolvedMap(mapPath, componentMapConfig.source, configContext, componentMapConfig.source);
    }

    const requestFileKey = options.requestFileKey ?? null;
    if (requestFileKey) {
      for (const source of ['b', 'd'] as const) {
        const mapPath = resolveBuiltInMapPath(source, configContext.projectRoot);
        if (existsSync(mapPath) && getSourceFileKey(mapPath) === requestFileKey) {
          return ComponentMap.loadResolvedMap(mapPath, source, configContext, source);
        }
      }
    }

    return {
      status: 'auto-unmatched',
      componentMap: null,
      configContext,
      requestedSource: 'auto',
      mapPath: null,
      message: configContext.configPath
        ? 'componentMap.source is "auto", but the requested Figma fileKey did not match b/d library files.'
        : 'No .figma-context-mcp.json was found and the requested Figma fileKey did not match b/d library files.',
    };
  }

  private static loadResolvedMap(
    mapPath: string,
    source: 'b' | 'd' | 'override',
    configContext: ProjectConfigContext,
    requestedSource: MapSource | 'override',
  ): ComponentMapResolution {
    if (!existsSync(mapPath)) {
      return {
        status: 'missing',
        componentMap: null,
        configContext,
        requestedSource,
        mapPath,
        message: `Component map file was not found: ${mapPath}`,
      };
    }

    try {
      return {
        status: 'loaded',
        componentMap: new ComponentMap(readRawMap(mapPath), source, mapPath),
        configContext,
        requestedSource,
        mapPath,
        message: 'Component map loaded.',
      };
    } catch (error) {
      return {
        status: 'invalid',
        componentMap: null,
        configContext,
        requestedSource,
        mapPath,
        message: `Component map file is invalid: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  resolveByComponentKey(componentKey: string): TiComponentHint {
    const looseEntry = this.looseEntries.get(componentKey);
    if (looseEntry) {
      return this.createHint(looseEntry);
    }

    const variantEntry = this.variantEntries.get(componentKey);
    if (variantEntry) {
      return this.createVariantHint(variantEntry.variant, variantEntry.parent);
    }

    const setKey = this.componentKeyToSetKey.get(componentKey);
    if (setKey) {
      return this.resolveBySetKey(setKey);
    }

    const setEntry = this.setEntries.get(componentKey);
    if (setEntry) {
      return this.createHint(setEntry);
    }

    return this.createNotFoundHint(componentKey);
  }

  resolveBySetKey(setKey: string): TiComponentHint {
    const entry = this.setEntries.get(setKey);
    return entry ? this.createHint(entry) : this.createNotFoundHint(setKey);
  }

  get summary(): ComponentMapSummary {
    const mapped = typeof this.rawMap.stats?.mappedComponentSetCount === 'number'
      ? this.rawMap.stats.mappedComponentSetCount
      : countEntriesByStatus(this.rawMap.componentSets, 'mapped');
    const unmapped = typeof this.rawMap.stats?.unresolvedComponentSetCount === 'number'
      ? this.rawMap.stats.unresolvedComponentSetCount
      : countEntriesByStatus(this.rawMap.componentSets, 'unresolved');
    const internal = typeof this.rawMap.stats?.internalComponentSetCount === 'number'
      ? this.rawMap.stats.internalComponentSetCount
      : countEntriesByStatus(this.rawMap.componentSets, 'internal');

    return {
      source: this.source,
      fileKey: asString(this.rawMap.sourceRegistry?.source?.fileKey),
      fileName: asString(this.rawMap.sourceRegistry?.source?.fileName),
      mapped,
      unmapped,
      internal,
      policy: this.rawMap.mappingPolicy?.strictNoGuessing === true
        ? 'identity-first; use configured variantProps when present; do not hand-roll components for unmapped nodes.'
        : 'component map policy unavailable; do not infer prop mappings automatically.',
    };
  }

  private createVariantHint(variant: RawComponentVariant, parent: RawMapEntry): TiComponentHint {
    const sourceStatus = this.normalizeVariantSourceStatus(variant.status);
    const target = isRecord(variant.target) ? variant.target : null;
    const hasVariantTarget = Boolean(asString(target?.library) && asString(target?.component));
    const isOverride = variant.status === 'mapped-override' || (hasVariantTarget && !asString(variant.targetRef));

    if (isOverride && target) {
      return this.createHint({
        figma: variant.figma,
        status: 'mapped',
        target,
        reason: variant.reason,
      });
    }

    if (sourceStatus === 'internal' || sourceStatus === 'unresolved') {
      return this.createHint({
        figma: variant.figma,
        status: sourceStatus,
        target: target ?? undefined,
        reason: variant.reason,
      });
    }

    return this.createHint(parent);
  }

  private createHint(entry: RawMapEntry): TiComponentHint {
    const sourceStatus = this.normalizeSourceStatus(entry.status);
    const library = asString(entry.target?.library);
    const component = asString(entry.target?.component);
    const variantProps = asStringRecord(entry.target?.props);
    const evidence = asStringArray(entry.target?.evidence);
    const fallbackReason = asString(entry.target?.fallbackReason) ?? (sourceStatus === 'mapped' ? null : asString(entry.reason));
    const status: TiComponentStatus = sourceStatus === 'mapped' && library && component
      ? 'mapped'
      : sourceStatus === 'internal'
        ? 'internal'
        : 'unmapped';

    return {
      library: status === 'mapped' ? library : null,
      component: status === 'mapped' ? component : null,
      status,
      sourceStatus,
      source: this.source,
      figmaName: asString(entry.figma?.name) ?? undefined,
      figmaKey: asString(entry.figma?.key) ?? undefined,
      evidence,
      fallbackReason: fallbackReason ?? (status === 'unmapped'
        ? 'No explicit TiComponents catalog entry, Element Plus fallback-table entry, or user-confirmed mapping was found for this Figma component.'
        : null),
      variantProps: status === 'mapped' ? variantProps : null,
      hint: this.createHintText(status, library, component, variantProps),
    };
  }

  private createNotFoundHint(componentKey: string): TiComponentHint {
    const fallbackReason = `Component key "${componentKey}" was not found in the selected ${this.source} component map. The configured source may be wrong or the map may be outdated.`;
    return {
      library: null,
      component: null,
      status: 'unmapped',
      sourceStatus: 'not-found',
      source: this.source,
      evidence: [],
      fallbackReason,
      variantProps: null,
      hint: `${fallbackReason} Declare this node as unmapped to the user; do not hand-roll a look-alike from visuals.`,
    };
  }

  private normalizeSourceStatus(status: unknown): TiComponentSourceStatus {
    if (status === 'mapped') return 'mapped';
    if (status === 'internal') return 'internal';
    if (status === 'unresolved') return 'unresolved';
    return 'not-found';
  }

  private normalizeVariantSourceStatus(status: unknown): TiComponentSourceStatus {
    if (status === 'mapped-override' || status === 'mapped-via-component-set' || status === 'mapped') return 'mapped';
    return this.normalizeSourceStatus(status);
  }

  private createHintText(
    status: TiComponentStatus,
    library: string | null,
    component: string | null,
    variantProps: TiComponentVariantProps,
  ): string {
    if (status === 'mapped' && library && component) {
      if (variantProps) {
        return `Use ${component} (${library}). Apply tiComponent.variantProps as explicit map-configured props; they are not an exhaustive prop whitelist. Then query the ti-component-skills skill for any remaining API/prop decisions.`;
      }

      return `Use ${component} (${library}). Query the ti-component-skills skill for prop API. Map Figma componentProperties to the component props manually when no tiComponent.variantProps are provided.`;
    }

    if (status === 'internal') {
      return 'Internal-only Figma component, not in codegen scope. Skip or treat as unmapped.';
    }

    return `No mapping in the selected ${this.source} component map. Declare this node as unmapped to the user; do not hand-roll a look-alike from visuals.`;
  }
}
