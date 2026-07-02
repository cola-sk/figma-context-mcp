import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { StyleStrategy } from './token-utils.js';

export const FIGMA_CONTEXT_CONFIG_FILE = '.figma-context-mcp.json';

export type TokenDetail = 'compact' | 'full';

export type FigmaContextConfig = {
  designTokenDir?: string;
  tokenSetId?: string;
  variablesTokenFile?: string;
  cssVariablesFile?: string;
  variableAliasFile?: string;
  styleStrategy?: StyleStrategy;
  tokenDetail?: TokenDetail;
  includeVariables?: boolean;
  includeVectorPaths?: boolean;
};

export type FigmaContextConfigResolution = {
  config: FigmaContextConfig;
  configPath?: string;
  warnings: string[];
};

const getDirectoryForSearch = (path: string): string => {
  try {
    return statSync(path).isDirectory() ? path : dirname(path);
  } catch {
    return path;
  }
};

const findConfigPathFrom = (startPath: string): string | undefined => {
  let directory = getDirectoryForSearch(startPath);

  while (true) {
    const candidate = join(directory, FIGMA_CONTEXT_CONFIG_FILE);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }

    directory = parent;
  }
};

const normalizeRootUri = (uri: string, warnings: string[]): string | undefined => {
  if (!uri.startsWith('file://')) {
    warnings.push(`Ignoring non-file workspace root while searching ${FIGMA_CONTEXT_CONFIG_FILE}: ${uri}`);
    return undefined;
  }

  try {
    return fileURLToPath(uri);
  } catch (error) {
    warnings.push(`Unable to read workspace root URI ${uri}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};

const readStringField = (
  source: Record<string, unknown>,
  target: FigmaContextConfig,
  key: keyof Pick<FigmaContextConfig, 'designTokenDir' | 'tokenSetId' | 'variablesTokenFile' | 'cssVariablesFile' | 'variableAliasFile'>,
  warnings: string[],
): void => {
  const value = source[key];

  if (value === undefined) {
    return;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    target[key] = value;
    return;
  }

  warnings.push(`${FIGMA_CONTEXT_CONFIG_FILE} field "${key}" must be a non-empty string.`);
};

const readBooleanField = (
  source: Record<string, unknown>,
  target: FigmaContextConfig,
  key: keyof Pick<FigmaContextConfig, 'includeVariables' | 'includeVectorPaths'>,
  warnings: string[],
): void => {
  const value = source[key];

  if (value === undefined) {
    return;
  }

  if (typeof value === 'boolean') {
    target[key] = value;
    return;
  }

  warnings.push(`${FIGMA_CONTEXT_CONFIG_FILE} field "${key}" must be a boolean.`);
};

const parseConfig = (raw: unknown, warnings: string[]): FigmaContextConfig => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    warnings.push(`${FIGMA_CONTEXT_CONFIG_FILE} must contain a JSON object.`);
    return {};
  }

  const source = raw as Record<string, unknown>;
  const config: FigmaContextConfig = {};

  readStringField(source, config, 'designTokenDir', warnings);
  readStringField(source, config, 'tokenSetId', warnings);
  readStringField(source, config, 'variablesTokenFile', warnings);
  readStringField(source, config, 'cssVariablesFile', warnings);
  readStringField(source, config, 'variableAliasFile', warnings);
  readBooleanField(source, config, 'includeVariables', warnings);
  readBooleanField(source, config, 'includeVectorPaths', warnings);

  if (source.styleStrategy !== undefined) {
    if (source.styleStrategy === 'preferTokens' || source.styleStrategy === 'tokensOnly') {
      config.styleStrategy = source.styleStrategy;
    } else {
      warnings.push(`${FIGMA_CONTEXT_CONFIG_FILE} field "styleStrategy" must be "preferTokens" or "tokensOnly".`);
    }
  }

  if (source.tokenDetail !== undefined) {
    if (source.tokenDetail === 'compact' || source.tokenDetail === 'full') {
      config.tokenDetail = source.tokenDetail;
    } else {
      warnings.push(`${FIGMA_CONTEXT_CONFIG_FILE} field "tokenDetail" must be "compact" or "full".`);
    }
  }

  return config;
};

export const loadFigmaContextConfig = (
  rootUris: string[] = [],
  fallbackSearchPath = process.cwd(),
): FigmaContextConfigResolution => {
  const warnings: string[] = [];
  const searchPaths = [
    ...rootUris
      .map((uri) => normalizeRootUri(uri, warnings))
      .filter((path): path is string => Boolean(path)),
    fallbackSearchPath,
  ];
  const uniqueSearchPaths = [...new Set(searchPaths)];
  const configPaths = [...new Set(
    uniqueSearchPaths
      .map(findConfigPathFrom)
      .filter((path): path is string => Boolean(path))
  )];
  const configPath = configPaths[0];

  if (!configPath) {
    return {
      config: {},
      warnings,
    };
  }

  if (configPaths.length > 1) {
    warnings.push(`Multiple ${FIGMA_CONTEXT_CONFIG_FILE} files were found; using ${configPath}.`);
  }

  try {
    return {
      config: parseConfig(JSON.parse(readFileSync(configPath, 'utf-8')), warnings),
      configPath,
      warnings,
    };
  } catch (error) {
    return {
      config: {},
      configPath,
      warnings: [
        ...warnings,
        `Unable to read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
};
