import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join } from 'path';

export type StyleStrategy = 'preferTokens' | 'tokensOnly';

type FigmaVariableCollection = {
  id: string;
  name: string;
  defaultModeId?: string;
  modes?: Array<{ modeId: string; name: string }>;
  variableIds?: string[];
};

type FigmaVariable = {
  id: string;
  key?: string;
  name: string;
  variableCollectionId: string;
  resolvedType: string;
  valuesByMode?: Record<string, unknown>;
  codeSyntax?: Record<string, string>;
};

type VariablesApiLikeResponse = {
  meta?: {
    variables?: Record<string, FigmaVariable>;
    variableCollections?: Record<string, FigmaVariableCollection>;
  };
};

type TokenSetManifestEntry = {
  apiLikeOutput?: string;
  cssVariablesMetadata?: string;
  remoteVariableAliases?: string;
};

type DesignTokenManifest = {
  tokenSets?: Record<string, TokenSetManifestEntry>;
};

export type TokenRegistry = {
  variables: Record<string, FigmaVariable>;
  variableCollections: Record<string, FigmaVariableCollection>;
  collectionNameById: Map<string, string>;
  cssVariableByTokenName: Map<string, string>;
  cssVariableByVariableId: Map<string, string>;
  variableIdByKey: Map<string, string>;
  variableAliasByVariableId: Map<string, string>;
  sourceFile: string;
  cssVariablesFile?: string;
  variableAliasFile?: string;
  designTokenDir?: string;
  tokenSetId?: string;
};

export type LoadTokenRegistryResult = {
  registry?: TokenRegistry;
  warnings: string[];
};

export type TokenBinding = {
  sourcePath: string;
  property: string;
  variableId: string;
  boundVariableId?: string;
  matchedBy?: 'directId' | 'variableKey' | 'aliasMap';
  name: string;
  collection: string;
  reference: string;
  cssVariable?: string;
  codeValue: string;
  resolvedType: string;
  resolvedValue?: string | number | boolean | null;
  chain: Array<{
    id: string;
    name: string;
    collection: string;
  }>;
};

export type TokenGap = {
  sourcePath: string;
  property: string;
  reason: string;
  variableId?: string;
  mappedVariableId?: string;
  variableKey?: string;
  variableName?: string;
  collection?: string;
};

export type NodeTokenContext = {
  strategy: StyleStrategy;
  bindings: TokenBinding[];
  gaps: TokenGap[];
};

type VariableAlias = {
  type: 'VARIABLE_ALIAS';
  id: string;
};

type ExtractedAlias = {
  sourcePath: string;
  property: string;
  variableId: string;
};

const BUSINESS_TOKEN_COLLECTIONS = new Set(['Semantic', 'Component']);
const BUSINESS_TOKEN_COLLECTION_LABEL = [...BUSINESS_TOKEN_COLLECTIONS].join(' or ');

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isVariableAlias = (value: unknown): value is VariableAlias =>
  isObject(value) && value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string';

const formatPath = (segments: Array<string | number>): string =>
  segments
    .map((segment, index) => {
      if (typeof segment === 'number') {
        return `[${segment}]`;
      }

      return index === 0 ? segment : `.${segment}`;
    })
    .join('');

const getPropertyFromSourcePath = (sourcePath: string): string => {
  const root = sourcePath.split(/[.[\]]/).filter(Boolean)[0];

  const map: Record<string, string> = {
    fills: 'fill',
    strokes: 'stroke',
    effects: 'effect',
    cornerRadius: 'borderRadius',
    rectangleCornerRadii: 'borderRadius',
    topLeftRadius: 'borderRadius',
    topRightRadius: 'borderRadius',
    bottomRightRadius: 'borderRadius',
    bottomLeftRadius: 'borderRadius',
    itemSpacing: 'gap',
    paddingTop: 'paddingTop',
    paddingRight: 'paddingRight',
    paddingBottom: 'paddingBottom',
    paddingLeft: 'paddingLeft',
    strokeWeight: 'strokeWidth',
    fontSize: 'fontSize',
    fontWeight: 'fontWeight',
    lineHeight: 'lineHeight',
    letterSpacing: 'letterSpacing',
    opacity: 'opacity',
  };

  return map[root] || root || sourcePath;
};

const extractAliases = (
  value: unknown,
  segments: Array<string | number> = [],
): ExtractedAlias[] => {
  if (isVariableAlias(value)) {
    const sourcePath = formatPath(segments);
    return [{
      sourcePath,
      property: getPropertyFromSourcePath(sourcePath),
      variableId: value.id,
    }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => extractAliases(item, [...segments, index]));
  }

  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, nestedValue]) =>
      extractAliases(nestedValue, [...segments, key])
    );
  }

  return [];
};

const uniqueAliases = (aliases: ExtractedAlias[]): ExtractedAlias[] => {
  const seen = new Set<string>();
  return aliases.filter((alias) => {
    const key = `${alias.sourcePath}:${alias.variableId}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const addBoundVariablesForPath = (
  aliases: ExtractedAlias[],
  boundVariables: unknown,
  defaultSourcePath: string,
  keyToSourcePath: Record<string, string> = {},
): void => {
  if (!isObject(boundVariables)) {
    return;
  }

  for (const [key, value] of Object.entries(boundVariables)) {
    const sourcePath = keyToSourcePath[key] || defaultSourcePath;
    for (const alias of extractAliases(value)) {
      aliases.push({
        sourcePath,
        property: getPropertyFromSourcePath(sourcePath),
        variableId: alias.variableId,
      });
    }
  }
};

const extractNodeAliases = (node: Record<string, unknown>): ExtractedAlias[] => {
  const aliases = extractAliases(node.boundVariables);

  if (Array.isArray(node.fills)) {
    node.fills.forEach((fill, index) => {
      if (isObject(fill)) {
        addBoundVariablesForPath(aliases, fill.boundVariables, `fills[${index}]`, {
          color: `fills[${index}]`,
        });
      }
    });
  }

  if (Array.isArray(node.strokes)) {
    node.strokes.forEach((stroke, index) => {
      if (isObject(stroke)) {
        addBoundVariablesForPath(aliases, stroke.boundVariables, `strokes[${index}]`, {
          color: `strokes[${index}]`,
        });
      }
    });
  }

  if (Array.isArray(node.effects)) {
    node.effects.forEach((effect, index) => {
      if (isObject(effect)) {
        addBoundVariablesForPath(aliases, effect.boundVariables, `effects[${index}]`, {
          color: `effects[${index}].color`,
          radius: `effects[${index}].radius`,
        });
      }
    });
  }

  if (isObject(node.style)) {
    addBoundVariablesForPath(aliases, node.style.boundVariables, 'style', {
      fontFamily: 'fontFamily',
      fontSize: 'fontSize',
      fontWeight: 'fontWeight',
      letterSpacing: 'letterSpacing',
      lineHeight: 'lineHeight',
      lineHeightPx: 'lineHeight',
    });
  }

  return uniqueAliases(aliases);
};

const isColorValue = (value: unknown): value is { r: number; g: number; b: number; a?: number } =>
  isObject(value)
  && typeof value.r === 'number'
  && typeof value.g === 'number'
  && typeof value.b === 'number';

const toHex = (channel: number): string => {
  const normalized = channel <= 1 ? channel * 255 : channel;
  return Math.round(Math.max(0, Math.min(255, normalized)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
};

export const formatFigmaColor = (color: unknown): string | undefined => {
  if (!isColorValue(color)) {
    return undefined;
  }

  const alpha = color.a ?? 1;
  const r = Math.round(Math.max(0, Math.min(255, color.r <= 1 ? color.r * 255 : color.r)));
  const g = Math.round(Math.max(0, Math.min(255, color.g <= 1 ? color.g * 255 : color.g)));
  const b = Math.round(Math.max(0, Math.min(255, color.b <= 1 ? color.b * 255 : color.b)));

  if (alpha < 1) {
    return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
  }

  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
};

const formatTokenValue = (value: unknown, resolvedType?: string): string | number | boolean | null | undefined => {
  if (isVariableAlias(value)) {
    return undefined;
  }

  if (isColorValue(value)) {
    return formatFigmaColor(value);
  }

  if (typeof value === 'number') {
    return resolvedType === 'FLOAT' ? `${value}px` : value;
  }

  if (typeof value === 'string' || typeof value === 'boolean' || value === null) {
    return value;
  }

  return undefined;
};

const getDefaultModeId = (variable: FigmaVariable, registry: TokenRegistry): string | undefined => {
  const collection = registry.variableCollections[variable.variableCollectionId];
  return collection?.defaultModeId
    || collection?.modes?.[0]?.modeId
    || Object.keys(variable.valuesByMode || {})[0];
};

const getValueByDefaultMode = (variable: FigmaVariable, registry: TokenRegistry): unknown => {
  const modeId = getDefaultModeId(variable, registry);
  if (!modeId) {
    return undefined;
  }

  return variable.valuesByMode?.[modeId];
};

const resolveVariableChain = (
  variableId: string,
  registry: TokenRegistry,
  seen: string[] = [],
): {
  variable?: FigmaVariable;
  chain: Array<{ id: string; name: string; collection: string }>;
  resolvedValue?: string | number | boolean | null;
} => {
  if (seen.includes(variableId)) {
    return { chain: [] };
  }

  const variable = registry.variables[variableId];
  if (!variable) {
    return { chain: [] };
  }

  const collection = registry.collectionNameById.get(variable.variableCollectionId) || '(unknown)';
  const chainItem = {
    id: variable.id,
    name: variable.name,
    collection,
  };
  const value = getValueByDefaultMode(variable, registry);

  if (isVariableAlias(value)) {
    const nested = resolveVariableChain(value.id, registry, [...seen, variableId]);
    return {
      variable,
      chain: [chainItem, ...nested.chain],
      resolvedValue: nested.resolvedValue,
    };
  }

  return {
    variable,
    chain: [chainItem],
    resolvedValue: formatTokenValue(value, variable.resolvedType),
  };
};

const parseCssVariableMap = (
  filePath: string,
  warnings: string[],
): {
  byTokenName: Map<string, string>;
  byVariableId: Map<string, string>;
} => {
  const byTokenName = new Map<string, string>();
  const byVariableId = new Map<string, string>();

  if (!existsSync(filePath)) {
    warnings.push(`CSS variable metadata file not found: ${filePath}`);
    return { byTokenName, byVariableId };
  }

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));

    if (!isObject(raw)) {
      warnings.push(`CSS variable metadata file must contain a JSON object: ${filePath}`);
      return { byTokenName, byVariableId };
    }

    const entries = isObject(raw.variables) ? Object.entries(raw.variables) : Object.entries(raw);

    for (const [key, value] of entries) {
      if (typeof value === 'string' && value.startsWith('--')) {
        byTokenName.set(key, value);
        continue;
      }

      if (key.startsWith('--') && isObject(value) && typeof value.token === 'string') {
        byTokenName.set(value.token, key);
        if (typeof value.variableId === 'string') {
          byVariableId.set(value.variableId, key);
        }
        continue;
      }

      if (isObject(value) && typeof value.cssVariable === 'string') {
        const tokenName = typeof value.token === 'string'
          ? value.token
          : typeof value.name === 'string'
            ? value.name
            : undefined;
        const variableId = typeof value.variableId === 'string'
          ? value.variableId
          : key.startsWith('VariableID:')
            ? key
            : undefined;

        if (tokenName) {
          byTokenName.set(tokenName, value.cssVariable);
        }

        if (variableId) {
          byVariableId.set(variableId, value.cssVariable);
        }
      }
    }
  } catch (error) {
    warnings.push(`Unable to read CSS variable metadata file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { byTokenName, byVariableId };
};

const parseVariableAliasMap = (
  filePath: string | undefined,
  warnings: string[],
): Map<string, string> => {
  const aliases = new Map<string, string>();

  if (!filePath) {
    return aliases;
  }

  if (!existsSync(filePath)) {
    return aliases;
  }

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    const entries = isObject(raw) && isObject(raw.aliases)
      ? Object.entries(raw.aliases)
      : isObject(raw)
        ? Object.entries(raw)
        : [];

    for (const [remoteVariableId, value] of entries) {
      if (!remoteVariableId.startsWith('VariableID:')) {
        continue;
      }

      if (typeof value === 'string' && value.startsWith('VariableID:')) {
        aliases.set(remoteVariableId, value);
        continue;
      }

      if (isObject(value)) {
        const localVariableId = typeof value.localVariableId === 'string'
          ? value.localVariableId
          : typeof value.variableId === 'string'
            ? value.variableId
            : undefined;

        if (localVariableId?.startsWith('VariableID:')) {
          aliases.set(remoteVariableId, localVariableId);
        }
      }
    }
  } catch (error) {
    warnings.push(`Unable to read Figma variable alias map ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return aliases;
};

const getVariableKeyFromBoundVariableId = (variableId: string): string | undefined => {
  const match = variableId.match(/^VariableID:([^/]+)\//);
  return match?.[1];
};

const resolvePathFromBase = (baseDir: string, filePath: string): string =>
  isAbsolute(filePath) ? filePath : join(baseDir, filePath);

const readDesignTokenManifest = (
  designTokenDir: string,
  warnings: string[],
): DesignTokenManifest | undefined => {
  const manifestFile = join(designTokenDir, 'manifest.json');

  if (!existsSync(manifestFile)) {
    warnings.push(`Design token manifest not found, using package path convention instead: ${manifestFile}`);
    return undefined;
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf-8'));
    return isObject(manifest) ? manifest as DesignTokenManifest : undefined;
  } catch (error) {
    warnings.push(`Unable to read design token manifest ${manifestFile}, using package path convention instead: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};

const getConfiguredTokenSetId = (tokenSetId?: string): string =>
  tokenSetId || process.env.TI_TOKEN_SET || process.env.TOKEN_SET_ID || 'd';

const inferTokenFilesFromRepo = (
  options: {
    designTokenDir?: string;
    tokenSetId?: string;
  },
  warnings: string[],
): {
  variablesTokenFile?: string;
  cssVariablesFile?: string;
  variableAliasFile?: string;
  designTokenDir?: string;
  tokenSetId?: string;
} => {
  const designTokenDir = options.designTokenDir || process.env.TI_DESIGN_TOKEN_DIR;

  if (!designTokenDir) {
    return {};
  }

  const tokenSetId = getConfiguredTokenSetId(options.tokenSetId);
  const manifest = readDesignTokenManifest(designTokenDir, warnings);
  const tokenSet = manifest?.tokenSets?.[tokenSetId];

  if (manifest?.tokenSets && !tokenSet) {
    warnings.push(`Token set "${tokenSetId}" was not found in ${join(designTokenDir, 'manifest.json')}, using package path convention instead.`);
  }

  return {
    variablesTokenFile: tokenSet?.apiLikeOutput
      ? resolvePathFromBase(designTokenDir, tokenSet.apiLikeOutput)
      : join(designTokenDir, 'packages', tokenSetId, 'dist', `ti-${tokenSetId}-variables-token.json`),
    cssVariablesFile: tokenSet?.cssVariablesMetadata
      ? resolvePathFromBase(designTokenDir, tokenSet.cssVariablesMetadata)
      : join(designTokenDir, 'packages', tokenSetId, 'dist', `ti-${tokenSetId}-css-variables.json`),
    variableAliasFile: tokenSet?.remoteVariableAliases
      ? resolvePathFromBase(designTokenDir, tokenSet.remoteVariableAliases)
      : join(designTokenDir, 'packages', tokenSetId, 'mappings', 'remote-variable-aliases.json'),
    designTokenDir,
    tokenSetId,
  };
};

export const loadTokenRegistry = (options: {
  variablesTokenFile?: string;
  cssVariablesFile?: string;
  variableAliasFile?: string;
  designTokenDir?: string;
  tokenSetId?: string;
} = {}): LoadTokenRegistryResult => {
  const warnings: string[] = [];
  const inferredFiles = inferTokenFilesFromRepo(options, warnings);
  const sourceFile = options.variablesTokenFile
    || process.env.FIGMA_VARIABLES_TOKEN_FILE
    || inferredFiles.variablesTokenFile;

  if (!sourceFile) {
    return {
      warnings: [
        'No design token source is configured. Set TI_DESIGN_TOKEN_DIR plus optional TI_TOKEN_SET, or set FIGMA_VARIABLES_TOKEN_FILE directly.',
      ],
    };
  }

  if (!existsSync(sourceFile)) {
    return {
      warnings: [`Figma variables token file not found: ${sourceFile}`],
    };
  }

  try {
    const raw = JSON.parse(readFileSync(sourceFile, 'utf-8')) as VariablesApiLikeResponse;
    const variables = raw.meta?.variables;
    const variableCollections = raw.meta?.variableCollections;

    if (!variables || !variableCollections) {
      return {
        warnings: [`Figma variables token file does not match the expected API-like shape: ${sourceFile}`],
      };
    }

    const collectionNameById = new Map<string, string>();
    for (const collection of Object.values(variableCollections)) {
      collectionNameById.set(collection.id, collection.name);
    }

    const variableIdByKey = new Map<string, string>();
    const duplicateKeys = new Set<string>();
    for (const variable of Object.values(variables)) {
      if (!variable.key) {
        continue;
      }

      if (variableIdByKey.has(variable.key)) {
        duplicateKeys.add(variable.key);
        continue;
      }

      variableIdByKey.set(variable.key, variable.id);
    }

    for (const key of duplicateKeys) {
      variableIdByKey.delete(key);
    }

    if (duplicateKeys.size > 0) {
      warnings.push(`Duplicate Figma variable keys found in token file; key matching disabled for ${duplicateKeys.size} duplicate key(s).`);
    }

    const cssVariablesFile = options.cssVariablesFile
      || process.env.FIGMA_CSS_VARIABLES_FILE
      || inferredFiles.cssVariablesFile;
    const cssVariableMap = cssVariablesFile
      ? parseCssVariableMap(cssVariablesFile, warnings)
      : {
          byTokenName: new Map<string, string>(),
          byVariableId: new Map<string, string>(),
        };
    const variableAliasFile = options.variableAliasFile
      || process.env.FIGMA_VARIABLE_ALIAS_FILE
      || inferredFiles.variableAliasFile;
    const variableAliasByVariableId = parseVariableAliasMap(variableAliasFile, warnings);

    return {
      registry: {
        variables,
        variableCollections,
        collectionNameById,
        cssVariableByTokenName: cssVariableMap.byTokenName,
        cssVariableByVariableId: cssVariableMap.byVariableId,
        variableIdByKey,
        variableAliasByVariableId,
        sourceFile,
        cssVariablesFile,
        variableAliasFile,
        designTokenDir: inferredFiles.designTokenDir,
        tokenSetId: inferredFiles.tokenSetId,
      },
      warnings,
    };
  } catch (error) {
    return {
      warnings: [`Unable to read Figma variables token file ${sourceFile}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
};

const createBinding = (
  alias: { sourcePath: string; property: string; variableId: string },
  registry: TokenRegistry,
): TokenBinding | TokenGap => {
  const variableKey = getVariableKeyFromBoundVariableId(alias.variableId);
  const keyMatchedVariableId = variableKey
    ? registry.variableIdByKey.get(variableKey)
    : undefined;
  const aliasMatchedVariableId = registry.variableAliasByVariableId.get(alias.variableId);
  const mappedVariableId = keyMatchedVariableId || aliasMatchedVariableId;
  const matchedBy = alias.variableId in registry.variables
    ? 'directId'
    : keyMatchedVariableId
      ? 'variableKey'
      : aliasMatchedVariableId
        ? 'aliasMap'
        : undefined;
  const canonicalVariableId = mappedVariableId || alias.variableId;
  const variable = registry.variables[canonicalVariableId];
  if (!variable) {
    return {
      sourcePath: alias.sourcePath,
      property: alias.property,
      variableId: alias.variableId,
      mappedVariableId,
      variableKey,
      reason: 'Variable id is bound in Figma, but it is missing from the configured token file.',
    };
  }

  const collection = registry.collectionNameById.get(variable.variableCollectionId) || '(unknown)';
  if (!BUSINESS_TOKEN_COLLECTIONS.has(collection)) {
    return {
      sourcePath: alias.sourcePath,
      property: alias.property,
      variableId: alias.variableId,
      mappedVariableId,
      variableKey,
      variableName: variable.name,
      collection,
      reason: `Only ${BUSINESS_TOKEN_COLLECTION_LABEL} variables are allowed in generated business code.`,
    };
  }

  const resolved = resolveVariableChain(variable.id, registry);
  const cssVariable = registry.cssVariableByVariableId.get(variable.id)
    || registry.cssVariableByTokenName.get(variable.name);

  if (!cssVariable) {
    return {
      sourcePath: alias.sourcePath,
      property: alias.property,
      variableId: alias.variableId,
      mappedVariableId,
      variableKey,
      variableName: variable.name,
      collection,
      reason: `${collection} variable is bound in Figma, but no CSS variable mapping was found for generated code.`,
    };
  }

  return {
    sourcePath: alias.sourcePath,
    property: alias.property,
    variableId: variable.id,
    boundVariableId: alias.variableId !== variable.id ? alias.variableId : undefined,
    matchedBy,
    name: variable.name,
    collection,
    reference: `{${variable.name}}`,
    cssVariable,
    codeValue: `var(${cssVariable})`,
    resolvedType: variable.resolvedType,
    resolvedValue: resolved.resolvedValue,
    chain: resolved.chain,
  };
};

const hasUsableBindingForProperty = (bindings: TokenBinding[], property: string): boolean =>
  bindings.some((binding) => binding.property === property);

const hasGapForProperty = (gaps: TokenGap[], property: string): boolean =>
  gaps.some((gap) => gap.property === property);

const addMissingGap = (
  gaps: TokenGap[],
  bindings: TokenBinding[],
  property: string,
  sourcePath: string,
): void => {
  if (hasUsableBindingForProperty(bindings, property) || hasGapForProperty(gaps, property)) {
    return;
  }

  gaps.push({
    sourcePath,
    property,
    reason: `No usable ${BUSINESS_TOKEN_COLLECTION_LABEL} variable is bound to this style property.`,
  });
};

const hasVisiblePaints = (paints: unknown): boolean =>
  Array.isArray(paints) && paints.some((paint) => isObject(paint) && paint.visible !== false);

const addTokenOnlyLiteralGaps = (node: Record<string, unknown>, bindings: TokenBinding[], gaps: TokenGap[]): void => {
  if (hasVisiblePaints(node.fills)) {
    addMissingGap(gaps, bindings, 'fill', 'fills');
  }

  if (hasVisiblePaints(node.strokes)) {
    addMissingGap(gaps, bindings, 'stroke', 'strokes');
  }

  if (typeof node.cornerRadius === 'number' || Array.isArray(node.rectangleCornerRadii)) {
    addMissingGap(gaps, bindings, 'borderRadius', 'cornerRadius');
  }

  for (const path of ['itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'strokeWeight']) {
    if (typeof node[path] === 'number') {
      addMissingGap(gaps, bindings, getPropertyFromSourcePath(path), path);
    }
  }

  if (isObject(node.style)) {
    for (const path of ['fontSize', 'fontWeight', 'lineHeightPx', 'letterSpacing']) {
      if (typeof node.style[path] === 'number') {
        addMissingGap(gaps, bindings, getPropertyFromSourcePath(path === 'lineHeightPx' ? 'lineHeight' : path), `style.${path}`);
      }
    }
  }
};

export const extractNodeTokenContext = (
  node: unknown,
  registry: TokenRegistry | undefined,
  strategy: StyleStrategy,
): NodeTokenContext => {
  if (!isObject(node)) {
    return { strategy, bindings: [], gaps: [] };
  }

  const aliases = extractNodeAliases(node);
  const bindings: TokenBinding[] = [];
  const gaps: TokenGap[] = [];

  for (const alias of aliases) {
    if (!registry) {
      gaps.push({
        sourcePath: alias.sourcePath,
        property: alias.property,
        variableId: alias.variableId,
        reason: 'A Figma variable is bound to this property, but no token file is configured to resolve it.',
      });
      continue;
    }

    const bindingOrGap = createBinding(alias, registry);
    if ('reason' in bindingOrGap) {
      gaps.push(bindingOrGap);
    } else {
      bindings.push(bindingOrGap);
    }
  }

  if (strategy === 'tokensOnly') {
    addTokenOnlyLiteralGaps(node, bindings, gaps);
  }

  return {
    strategy,
    bindings,
    gaps,
  };
};

const rootPath = (path: string): string => path.split('[')[0].split('.')[0];

const propertyFromPath = (path: string): string => {
  const lastSegment = path.split('.').pop() || path;
  return getPropertyFromSourcePath(lastSegment);
};

export const findBindingForPath = (context: NodeTokenContext, path: string): TokenBinding | undefined =>
  context.bindings.find((binding) => binding.sourcePath === path)
  || context.bindings.find((binding) => rootPath(binding.sourcePath) === rootPath(path))
  || context.bindings.find((binding) => binding.property === propertyFromPath(path));

export const findGapForPath = (context: NodeTokenContext, path: string): TokenGap | undefined =>
  context.gaps.find((gap) => gap.sourcePath === path)
  || context.gaps.find((gap) => rootPath(gap.sourcePath) === rootPath(path))
  || context.gaps.find((gap) => gap.property === propertyFromPath(path));

export const createStyleValue = (
  literalValue: unknown,
  context: NodeTokenContext,
  path: string,
): unknown => {
  const binding = findBindingForPath(context, path);
  if (binding) {
    return binding.codeValue;
  }

  const gap = findGapForPath(context, path);
  if (context.strategy === 'tokensOnly' && gap) {
    return {
      tokenGap: gap.reason,
      property: gap.property,
    };
  }

  return literalValue;
};

export const createTokenUsageSummary = (
  simplifiedNodeData: unknown,
  tokenWarnings: string[],
): {
  bindingCount: number;
  gapCount: number;
  warnings: string[];
} => {
  let bindingCount = 0;
  let gapCount = 0;

  const visit = (value: unknown): void => {
    if (!isObject(value) && !Array.isArray(value)) {
      return;
    }

    if (isObject(value)) {
      if (Array.isArray(value.tokenBindings)) {
        bindingCount += value.tokenBindings.length;
      }

      if (Array.isArray(value.tokenGaps)) {
        gapCount += value.tokenGaps.length;
      }

      for (const nested of Object.values(value)) {
        visit(nested);
      }
      return;
    }

    for (const nested of value) {
      visit(nested);
    }
  };

  visit(simplifiedNodeData);

  return {
    bindingCount,
    gapCount,
    warnings: tokenWarnings,
  };
};
