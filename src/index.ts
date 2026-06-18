#!/usr/bin/env node
import { z } from 'zod';
import { isInitializeRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { ExpressHttpStreamableMcpServer } from "./server-runner.js";
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createStyleValue,
  createTokenUsageSummary,
  extractNodeTokenContext,
  findBindingForPath,
  findGapForPath,
  formatFigmaColor,
  loadTokenRegistry,
  StyleStrategy,
} from './token-utils.js';

type TokenDetail = 'compact' | 'full';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const getDefaultStyleStrategy = (): StyleStrategy => {
  const value = process.env.FIGMA_STYLE_STRATEGY;
  return value === 'tokensOnly' || value === 'preferTokens' ? value : 'preferTokens';
};

const getDefaultIncludeVariables = (): boolean =>
  process.env.FIGMA_INCLUDE_VARIABLES === '1'
  || process.env.FIGMA_INCLUDE_VARIABLES === 'true';

const getDefaultIncludeVectorPaths = (): boolean =>
  process.env.FIGMA_INCLUDE_VECTOR_PATHS === '1'
  || process.env.FIGMA_INCLUDE_VECTOR_PATHS === 'true';

const getDefaultTokenDetail = (): TokenDetail => {
  const value = process.env.FIGMA_TOKEN_DETAIL;
  return value === 'full' ? 'full' : 'compact';
};

const isEmptyValue = (value: unknown): boolean =>
  value === undefined
  || value === null
  || (Array.isArray(value) && value.length === 0)
  || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);

const isDefaultConstraint = (constraints: any): boolean =>
  constraints?.vertical === 'TOP' && constraints?.horizontal === 'LEFT';

const cleanObject = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, nestedValue]) => !isEmptyValue(nestedValue))
  ) as Partial<T>;

const compactBoundVariables = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(compactBoundVariables);
  }

  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;

    if (object.type === 'VARIABLE_ALIAS' && typeof object.id === 'string') {
      return {
        type: object.type,
        id: object.id,
      };
    }

    return Object.fromEntries(
      Object.entries(object).map(([key, nestedValue]) => [key, compactBoundVariables(nestedValue)])
    );
  }

  return value;
};

const maybeCompactVariableFields = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(maybeCompactVariableFields);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        key === 'boundVariables' ? compactBoundVariables(nestedValue) : maybeCompactVariableFields(nestedValue),
      ])
    );
  }

  return value;
};

const normalizeColorFields = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeColorFields);
  }

  const object = value as Record<string, unknown>;
  if (
    typeof object.r === 'number'
    && typeof object.g === 'number'
    && typeof object.b === 'number'
  ) {
    return {
      r: Math.round(object.r * 255),
      g: Math.round(object.g * 255),
      b: Math.round(object.b * 255),
      a: typeof object.a === 'number' ? Math.round(object.a * 100) / 100 : 1,
    };
  }

  return Object.fromEntries(
    Object.entries(object).map(([key, nestedValue]) => [key, normalizeColorFields(nestedValue)])
  );
};

const stripVariableFields = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(stripVariableFields);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'boundVariables' && key !== 'explicitVariableModes')
      .map(([key, nestedValue]) => [key, stripVariableFields(nestedValue)])
  );
};

const normalizeDesignValue = (value: unknown, includeVariables: boolean): unknown => {
  const normalized = maybeCompactVariableFields(normalizeColorFields(value));
  return includeVariables ? normalized : stripVariableFields(normalized);
};

// Get transport mode from environment or command-line args
const args = process.argv.slice(2);

// Handle --version flag
if (args.includes('--version') || args.includes('-v')) {
  try {
    const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
    console.error(`figma-context-mcp v${packageJson.version}`);
    process.exit(0);
  } catch (error) {
    console.error('figma-context-mcp (version unknown)');
    process.exit(0);
  }
}

// Handle --help flag
if (args.includes('--help') || args.includes('-h')) {
  console.error(`
figma-context-mcp - AI-powered Figma to Code conversion

Usage:
  figma-context-mcp [options]
  npx @sking7/figma-context-mcp [options]

Options:
  --mode <stdio|http>   Transport mode (default: stdio)
  --port <number>       Port for HTTP mode (default: 3000)
  --version, -v         Show version number
  --help, -h            Show this help message

Examples:
  # Run in stdio mode (for Claude Desktop, Cursor)
  npx @sking7/figma-context-mcp

  # Run in HTTP server mode on port 3000
  npx @sking7/figma-context-mcp --mode http --port 3000

  # Show version
  npx @sking7/figma-context-mcp --version
`);
  process.exit(0);
}

const modeIndex = args.indexOf('--mode');
const portIndex = args.indexOf('--port');

const TRANSPORT_MODE = modeIndex !== -1 ? args[modeIndex + 1] : process.env.MCP_TRANSPORT_MODE || 'stdio';
const PORT = portIndex !== -1 ? parseInt(args[portIndex + 1]) : parseInt(process.env.MCP_PORT || '3000');

console.error(`Initializing figma-context-mcp in ${TRANSPORT_MODE} mode${TRANSPORT_MODE === 'http' ? ` on port ${PORT}` : ''}`)

// Helper function to get data directory path
const getDataPath = (relativePath: string): string => {
  // Try relative to current working directory first (for development)
  const cwdPath = join(process.cwd(), 'data', relativePath);
  try {
    readFileSync(cwdPath, 'utf-8');
    return cwdPath;
  } catch {
    // Fall back to package directory (for npm installation)
    return join(__dirname, '..', 'data', relativePath);
  }
};

// Function to setup all resources and tools
const setupServer = (server: McpServer) => {

    server.resource(
      "figma_overview",
      "figma://overview/file",
      {
        description: "Overview of the convert-figma-to-code MCP server and its capabilities.",
        title: "Overview",
        mimeType: "text/markdown",
      },
      async (uri) => {
        const overviewContent = readFileSync(getDataPath("overview.md"), "utf-8");
        
        return {
          contents: [
            {
              uri: uri.href,
              text: overviewContent,
              mimeType: "text/markdown",
            },
          ],
        };
      }
    );
  
    server.resource(
      "figma_quickstart",
      "figma://quickstart/file",
      {
        description: "Quickstart guide for using convert-figma-to-code MCP server.",
        title: "Quickstart",
        mimeType: "text/markdown",
      },
      async (uri) => {
        const quickstartContent = readFileSync(getDataPath("quickstart.md"), "utf-8");
        
        return {
          contents: [
            {
              uri: uri.href,
              text: quickstartContent,
              mimeType: "text/markdown",
            },
          ],
        };
      }
    );

    server.tool(
      'convert-figma-to-code',
      'Fetches a Figma node and rendered image from the Figma API, resolves bound Figma variables through the configured token file, and returns token-aware code generation context.',
      {
        figmaNodeUrl: z.string().describe('The URL of the Figma node (e.g., https://www.figma.com/design/fileKey/fileName?node-id=123-456)'),
        styleStrategy: z.enum(['preferTokens', 'tokensOnly']).optional().describe('Controls generated style guidance. preferTokens uses token variables when available and falls back to literals. tokensOnly requires token variables and reports token gaps instead of allowing literal style values. Defaults to FIGMA_STYLE_STRATEGY, then preferTokens.'),
        tokenDetail: z.enum(['compact', 'full']).optional().describe('Controls token metadata verbosity in the returned JSON. compact keeps code-generation essentials; full includes references, resolved values, and token chains for debugging. Defaults to FIGMA_TOKEN_DETAIL, then compact.'),
        designTokenDir: z.string().optional().describe('Optional absolute path to the ti-d-design-token repository. Defaults to TI_DESIGN_TOKEN_DIR.'),
        tokenSetId: z.string().optional().describe('Optional token set id such as d or b. Defaults to TI_TOKEN_SET, then d.'),
        includeVariables: z.boolean().optional().describe('Includes compact raw Figma boundVariables in the simplified JSON for debugging. Defaults to FIGMA_INCLUDE_VARIABLES.'),
        includeVectorPaths: z.boolean().optional().describe('Whether to request and include raw vector path data. Defaults to FIGMA_INCLUDE_VECTOR_PATHS.'),
        variablesTokenFile: z.string().optional().describe('Advanced override: absolute path to packages/d/dist/ti-d-variables-token.json. Defaults to FIGMA_VARIABLES_TOKEN_FILE, then TI_DESIGN_TOKEN_DIR + TI_TOKEN_SET.'),
        cssVariablesFile: z.string().optional().describe('Advanced override: absolute path to packages/d/dist/ti-d-css-variables.json or packages/d/mappings/css-variable-map.json. Defaults to FIGMA_CSS_VARIABLES_FILE, then TI_DESIGN_TOKEN_DIR + TI_TOKEN_SET.'),
        variableAliasFile: z.string().optional().describe('Advanced override: absolute path to remote-variable-aliases.json. Defaults to FIGMA_VARIABLE_ALIAS_FILE, then TI_DESIGN_TOKEN_DIR + TI_TOKEN_SET.'),
      },
      async ({
        figmaNodeUrl,
        styleStrategy,
        tokenDetail,
        designTokenDir,
        tokenSetId,
        includeVariables,
        includeVectorPaths,
        variablesTokenFile,
        cssVariablesFile,
        variableAliasFile,
      }: {
        figmaNodeUrl: string;
        styleStrategy?: StyleStrategy;
        tokenDetail?: TokenDetail;
        designTokenDir?: string;
        tokenSetId?: string;
        includeVariables?: boolean;
        includeVectorPaths?: boolean;
        variablesTokenFile?: string;
        cssVariablesFile?: string;
        variableAliasFile?: string;
      }): Promise<CallToolResult> => {
        try {
          // Get Figma access token from environment variables
          const figmaAccessToken = process.env.FIGMA_ACCESS_TOKEN;
          
          if (!figmaAccessToken) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: FIGMA_ACCESS_TOKEN environment variable is not set.

To use this tool, you need to:
1. Generate a Personal Access Token from Figma:
   - Go to Figma > Settings > Account > Personal access tokens
   - Generate a new token
2. Set the FIGMA_ACCESS_TOKEN environment variable with your token

Example for your MCP config:
{
  "env": {
    "FIGMA_ACCESS_TOKEN": "your-personal-access-token"
  }
}`,
                },
              ],
            };
          }

          const effectiveStyleStrategy = styleStrategy || getDefaultStyleStrategy();
          const effectiveTokenDetail = tokenDetail || getDefaultTokenDetail();
          const shouldIncludeVariables = includeVariables ?? getDefaultIncludeVariables();
          const shouldIncludeVectorPaths = includeVectorPaths ?? getDefaultIncludeVectorPaths();
          const tokenLoadResult = loadTokenRegistry({
            designTokenDir,
            tokenSetId,
            variablesTokenFile,
            cssVariablesFile,
            variableAliasFile,
          });
          const tokenRegistry = tokenLoadResult.registry;

          if (!tokenRegistry && effectiveStyleStrategy === 'tokensOnly') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: tokensOnly strategy requires a configured token file.

Set TI_DESIGN_TOKEN_DIR to the absolute path of the token repository:
/path/to/ti-d-design-token

Optional:
TI_TOKEN_SET=d

Advanced override:
FIGMA_VARIABLES_TOKEN_FILE=/path/to/ti-d-design-token/packages/d/dist/ti-d-variables-token.json

Details:
${tokenLoadResult.warnings.map((warning) => `- ${warning}`).join('\n')}`,
                },
              ],
            };
          }

          // Parse Figma URL to extract fileKey and nodeId
          // URL formats:
          // https://www.figma.com/file/{fileKey}/{fileName}?node-id={nodeId}
          // https://www.figma.com/design/{fileKey}/{fileName}?node-id={nodeId}
          const urlPattern = /figma\.com\/(file|design)\/([a-zA-Z0-9]+)(?:\/[^?]*)?(?:\?.*node-id=([^&]+))?/;
          const match = figmaNodeUrl.match(urlPattern);

          if (!match) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: Invalid Figma URL format.

Expected formats:
- https://www.figma.com/file/{fileKey}/{fileName}?node-id={nodeId}
- https://www.figma.com/design/{fileKey}/{fileName}?node-id={nodeId}

Provided URL: ${figmaNodeUrl}`,
                },
              ],
            };
          }

          const fileKey = match[2];
          const nodeId = match[3] ? decodeURIComponent(match[3]) : null;

          if (!nodeId) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: No node-id found in the Figma URL.

Please make sure your URL includes a node-id parameter.
Example: https://www.figma.com/design/${fileKey}/FileName?node-id=123-456

Provided URL: ${figmaNodeUrl}`,
                },
              ],
            };
          }

          // API headers
          const headers = {
            'X-Figma-Token': figmaAccessToken,
          };

          // Fetch node data
          const nodeApiUrl = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}${shouldIncludeVectorPaths ? '&geometry=paths' : ''}`;
          const nodeResponse = await fetch(nodeApiUrl, { headers });

          if (!nodeResponse.ok) {
            const errorText = await nodeResponse.text();
            return {
              content: [
                {
                  type: 'text',
                  text: `Error fetching Figma node data:
Status: ${nodeResponse.status} ${nodeResponse.statusText}
Response: ${errorText}

API URL: ${nodeApiUrl}`,
                },
              ],
            };
          }

          const nodeData = await nodeResponse.json();

          // Fetch node image
          const imageApiUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&scale=2`;
          const imageResponse = await fetch(imageApiUrl, { headers });

          if (!imageResponse.ok) {
            const errorText = await imageResponse.text();
            return {
              content: [
                {
                  type: 'text',
                  text: `Error fetching Figma node image:
Status: ${imageResponse.status} ${imageResponse.statusText}
Response: ${errorText}

API URL: ${imageApiUrl}
Node data was retrieved successfully.`,
                },
              ],
            };
          }

          const imageData = await imageResponse.json();

          // Extract the image URL from the response
          const imageUrl = imageData.images?.[nodeId] || imageData.images?.[Object.keys(imageData.images)[0]] || null;

          // Helper function to simplify Figma node data - extracts only essential info for code conversion
          const summarizeBinding = (binding: ReturnType<typeof findBindingForPath>) => {
            if (!binding) return undefined;
            if (effectiveTokenDetail === 'compact') {
              return {
                sourcePath: binding.sourcePath,
                property: binding.property,
                cssVariable: binding.cssVariable,
                codeValue: binding.codeValue,
              };
            }
            return {
              sourcePath: binding.sourcePath,
              property: binding.property,
              reference: binding.reference,
              cssVariable: binding.cssVariable,
              codeValue: binding.codeValue,
              resolvedValue: binding.resolvedValue,
            };
          };

          const summarizeGap = (gap: ReturnType<typeof findGapForPath>) => {
            if (!gap) return undefined;
            const compactGap = {
              sourcePath: gap.sourcePath,
              property: gap.property,
              reason: gap.reason,
            };
            return effectiveTokenDetail === 'compact'
              ? compactGap
              : {
                  ...compactGap,
                  variableName: gap.variableName,
                  collection: gap.collection,
                };
          };

          const simplifyNode = (node: any, parentBounds?: any, parentLayoutMode?: string): any => {
            if (!node) return null;

            const tokenContext = tokenRegistry
              ? extractNodeTokenContext(node, tokenRegistry, effectiveStyleStrategy)
              : { strategy: effectiveStyleStrategy, bindings: [], gaps: [] };
            
            const simplified: any = {
              id: node.id,
              type: node.type,
              name: node.name,
            };

            const copyFields = (fields: string[]) => {
              fields.forEach((field) => {
                const fieldValue = normalizeDesignValue(node[field], shouldIncludeVariables);
                if (!isEmptyValue(fieldValue)) {
                  simplified[field] = fieldValue;
                }
              });
            };

            if (node.visible === false) {
              simplified.visible = false;
            }
            if (node.locked === true) {
              simplified.locked = true;
            }
            if (node.opacity !== undefined && node.opacity !== 1) {
              simplified.opacity = node.opacity;
            }
            if (node.blendMode && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
              simplified.blendMode = node.blendMode;
            }
            if (node.isMask === true) {
              simplified.isMask = true;
              if (node.maskType) {
                simplified.maskType = node.maskType;
              }
            }
            if (Math.abs(node.rotation || 0) > 0.001) {
              simplified.rotation = Math.round(node.rotation * 1000) / 1000;
            }
            if (node.constraints && !isDefaultConstraint(node.constraints)) {
              simplified.constraints = node.constraints;
            }
            if (node.clipsContent === true) {
              simplified.clipsContent = true;
            }

            copyFields([
              'componentId',
              'componentProperties',
              'componentPropertyReferences',
              'styles',
            ]);

            if (shouldIncludeVariables) {
              copyFields(['boundVariables', 'explicitVariableModes']);
            }

            if (tokenContext.bindings.length > 0) {
              simplified.tokenBindings = tokenContext.bindings.map((binding) => {
                if (effectiveTokenDetail === 'compact') {
                  return {
                    sourcePath: binding.sourcePath,
                    property: binding.property,
                    cssVariable: binding.cssVariable,
                    codeValue: binding.codeValue,
                  };
                }

                return {
                  sourcePath: binding.sourcePath,
                  property: binding.property,
                  reference: binding.reference,
                  cssVariable: binding.cssVariable,
                  codeValue: binding.codeValue,
                  resolvedType: binding.resolvedType,
                  resolvedValue: binding.resolvedValue,
                  chain: binding.chain.map((item) => item.name),
                };
              });
            }

            if (tokenContext.gaps.length > 0) {
              simplified.tokenGaps = tokenContext.gaps.map((gap) => {
                const compactGap = {
                  sourcePath: gap.sourcePath,
                  property: gap.property,
                  reason: gap.reason,
                };

                return effectiveTokenDetail === 'compact'
                  ? compactGap
                  : {
                      ...compactGap,
                      variableName: gap.variableName,
                      collection: gap.collection,
                    };
              });
            }

            // Add dimensions if available
            if (node.absoluteBoundingBox) {
              simplified.size = {
                width: Math.round(node.absoluteBoundingBox.width),
                height: Math.round(node.absoluteBoundingBox.height),
              };
            }

            const parentIsAutoLayout = parentLayoutMode === 'HORIZONTAL' || parentLayoutMode === 'VERTICAL';
            const isAbsolutelyPositioned = node.layoutPositioning && node.layoutPositioning !== 'AUTO';
            if (parentBounds && node.absoluteBoundingBox && (!parentIsAutoLayout || isAbsolutelyPositioned)) {
              simplified.position = {
                x: Math.round(node.absoluteBoundingBox.x - parentBounds.x),
                y: Math.round(node.absoluteBoundingBox.y - parentBounds.y),
              };
            }

            // Add layout info for frames
            if (node.layoutMode) {
              simplified.layout = {
                mode: node.layoutMode, // HORIZONTAL, VERTICAL, NONE
                wrap: node.layoutWrap, // WRAP, NO_WRAP
                padding: [
                  node.paddingTop,
                  node.paddingRight,
                  node.paddingBottom,
                  node.paddingLeft,
                ].some((padding) => typeof padding === 'number') ? {
                  top: createStyleValue(node.paddingTop, tokenContext, 'paddingTop'),
                  right: createStyleValue(node.paddingRight, tokenContext, 'paddingRight'),
                  bottom: createStyleValue(node.paddingBottom, tokenContext, 'paddingBottom'),
                  left: createStyleValue(node.paddingLeft, tokenContext, 'paddingLeft'),
                } : undefined,
                gap: createStyleValue(node.itemSpacing, tokenContext, 'itemSpacing'),
                primaryAxisAlign: node.primaryAxisAlignItems,
                counterAxisAlign: node.counterAxisAlignItems,
                primaryAxisSizing: node.primaryAxisSizingMode,
                counterAxisSizing: node.counterAxisSizingMode,
                itemReverseZIndex: node.itemReverseZIndex,
                strokesIncludedInLayout: node.strokesIncludedInLayout,
              };
              simplified.layout = cleanObject(simplified.layout);
            }

            // Add child sizing behavior within parent auto-layout (HUG / FILL / FIXED)
            if (
              node.layoutSizingHorizontal
              || node.layoutSizingVertical
              || node.layoutAlign
              || node.layoutGrow !== undefined
              || node.minWidth !== undefined
              || node.maxWidth !== undefined
              || node.minHeight !== undefined
              || node.maxHeight !== undefined
            ) {
              simplified.sizing = cleanObject({
                horizontal: node.layoutSizingHorizontal,
                vertical: node.layoutSizingVertical,
                align: node.layoutAlign,
                grow: node.layoutGrow,
                minWidth: node.minWidth,
                maxWidth: node.maxWidth,
                minHeight: node.minHeight,
                maxHeight: node.maxHeight,
              });
            }

            // Add positioning mode within parent auto-layout (AUTO / ABSOLUTE)
            if (node.layoutPositioning && node.layoutPositioning !== 'AUTO') {
              simplified.positioning = node.layoutPositioning;
            }

            // Add corner radius
            if (typeof node.cornerRadius === 'number') {
              simplified.borderRadius = createStyleValue(node.cornerRadius, tokenContext, 'cornerRadius');
            } else if (node.rectangleCornerRadii) {
              simplified.borderRadius = createStyleValue(node.rectangleCornerRadii, tokenContext, 'rectangleCornerRadii');
            }
            if (node.cornerSmoothing !== undefined && node.cornerSmoothing !== 0) {
              simplified.cornerSmoothing = node.cornerSmoothing;
            }

            // Add fills (background colors)
            if (node.fills && node.fills.length > 0) {
              simplified.fills = node.fills
                .filter((fill: any) => fill.visible !== false)
                .map((fill: any, index: number) => {
                  const sourcePath = `fills[${index}]`;
                  const binding = findBindingForPath(tokenContext, sourcePath);
                  const gap = findGapForPath(tokenContext, sourcePath);
                  const literalColor = formatFigmaColor(fill.color);
                  const normalizedFill = normalizeDesignValue(fill, shouldIncludeVariables) as Record<string, unknown>;

                  return cleanObject({
                    ...normalizedFill,
                    value: createStyleValue(literalColor, tokenContext, sourcePath),
                    token: summarizeBinding(binding),
                    tokenGap: summarizeGap(gap),
                    literalFallback: effectiveStyleStrategy === 'preferTokens' ? literalColor : undefined,
                  });
                });
            }

            // Add strokes (borders)
            if (node.strokes && node.strokes.length > 0) {
              simplified.strokes = node.strokes
                .filter((stroke: any) => stroke.visible !== false)
                .map((stroke: any, index: number) => {
                  const sourcePath = `strokes[${index}]`;
                  const binding = findBindingForPath(tokenContext, sourcePath);
                  const gap = findGapForPath(tokenContext, sourcePath);
                  const literalColor = formatFigmaColor(stroke.color);
                  const normalizedStroke = normalizeDesignValue(stroke, shouldIncludeVariables) as Record<string, unknown>;

                  return cleanObject({
                    ...normalizedStroke,
                    value: createStyleValue(literalColor, tokenContext, sourcePath),
                    token: summarizeBinding(binding),
                    tokenGap: summarizeGap(gap),
                    literalFallback: effectiveStyleStrategy === 'preferTokens' ? literalColor : undefined,
                  });
                });
              if (typeof node.strokeWeight === 'number') {
                simplified.strokeWeight = createStyleValue(node.strokeWeight, tokenContext, 'strokeWeight');
              }
              copyFields(['strokeAlign', 'strokeDashes', 'individualStrokeWeights']);
            }

            // Add effects (shadows, blur)
            if (node.effects && node.effects.length > 0) {
              simplified.effects = node.effects
                .filter((effect: any) => effect.visible !== false)
                .map((effect: any, index: number) => {
                  const normalizedEffect = normalizeDesignValue(effect, shouldIncludeVariables) as Record<string, unknown>;

                  return cleanObject({
                    ...normalizedEffect,
                    radius: createStyleValue(effect.radius, tokenContext, `effects[${index}].radius`),
                    color: createStyleValue(formatFigmaColor(effect.color), tokenContext, `effects[${index}].color`),
                  });
                });
            }

            // Add text-specific properties
            if (node.type === 'TEXT') {
              simplified.text = node.characters;
              if (node.style) {
                simplified.textStyle = cleanObject({
                  ...(normalizeDesignValue(node.style, shouldIncludeVariables) as Record<string, unknown>),
                  fontFamily: node.style.fontFamily,
                  fontWeight: createStyleValue(node.style.fontWeight, tokenContext, 'fontWeight'),
                  fontSize: createStyleValue(node.style.fontSize, tokenContext, 'fontSize'),
                  lineHeight: createStyleValue(node.style.lineHeightPx, tokenContext, 'lineHeight'),
                  letterSpacing: createStyleValue(node.style.letterSpacing, tokenContext, 'letterSpacing'),
                  textAlign: node.style.textAlignHorizontal,
                  textAlignVertical: node.style.textAlignVertical,
                  textCase: node.style.textCase,
                  textDecoration: node.style.textDecoration,
                  paragraphSpacing: node.style.paragraphSpacing,
                  paragraphIndent: node.style.paragraphIndent,
                });
              }
              copyFields(['styleOverrideTable', 'characterStyleOverrides', 'textAutoResize']);
            }

            if (shouldIncludeVectorPaths && node.vectorPaths) {
              simplified.vectorPaths = node.vectorPaths;
            }

            // Recursively process children
            if (node.children && node.children.length > 0) {
              simplified.children = node.children
                .map((child: any) => simplifyNode(child, node.absoluteBoundingBox, node.layoutMode))
                .filter(Boolean);
            }

            return simplified;
          };

          const slimComponents = (map: Record<string, any> | undefined) => {
            if (!map) return undefined;
            return Object.fromEntries(
              Object.entries(map).map(([id, component]) => [id, cleanObject({
                key: component.key,
                name: component.name,
                description: component.description || undefined,
                componentSetId: component.componentSetId || undefined,
              })])
            );
          };

          const slimComponentSets = (map: Record<string, any> | undefined) => {
            if (!map) return undefined;
            return Object.fromEntries(
              Object.entries(map).map(([id, componentSet]) => [id, cleanObject({
                key: componentSet.key,
                name: componentSet.name,
                description: componentSet.description || undefined,
              })])
            );
          };

          const slimStyles = (map: Record<string, any> | undefined) => {
            if (!map) return undefined;
            return Object.fromEntries(
              Object.entries(map).map(([id, style]) => [id, cleanObject({
                key: style.key,
                name: style.name,
                styleType: style.styleType,
                description: style.description || undefined,
              })])
            );
          };

          // Simplify the node data
          const simplifiedNodeData = nodeData.nodes ? 
            Object.keys(nodeData.nodes).reduce((acc: any, key: string) => {
              const node = nodeData.nodes[key];
              acc[key] = cleanObject({
                document: simplifyNode(node.document),
                components: slimComponents(node.components),
                componentSets: slimComponentSets(node.componentSets),
                styles: slimStyles(node.styles),
              });
              return acc;
            }, {}) 
            : simplifyNode(nodeData);

          const tokenUsageSummary = createTokenUsageSummary(
            simplifiedNodeData,
            tokenLoadResult.warnings,
          );
          const prettyNodeData = JSON.stringify(simplifiedNodeData, null, 2);
          const nodeDataJson = prettyNodeData.length > 200000
            ? JSON.stringify(simplifiedNodeData)
            : prettyNodeData;
          const hasTokenGaps = tokenUsageSummary.gapCount > 0;
          const canGenerateCode = effectiveStyleStrategy !== 'tokensOnly' || !hasTokenGaps;
          const canGenerateTokenPureCode = !hasTokenGaps;

          const strategyInstructions = effectiveStyleStrategy === 'tokensOnly'
            ? `- Strategy is \`tokensOnly\`: every generated style value that corresponds to color, radius, spacing, stroke, shadow, or typography must come from a Semantic or Component token.
   - Use \`codeValue\` from \`tokenBindings\` whenever present.
   - If any \`tokenGap\` exists, do not generate final page code yet. Report the missing token coverage first.
   - Never replace a \`tokenGap\` with a literal color, px value, or guessed variable.
   - Do not use \`literalFallback\` values in final code.`
            : `- Strategy is \`preferTokens\`: use \`codeValue\` from \`tokenBindings\` whenever present.
   - Only use \`literalFallback\` when no usable Semantic or Component token is bound to that property.
   - Prefer CSS variables when \`cssVariable\` is present; otherwise preserve the token reference shown in \`codeValue\`.`;

          const tokenMetadataLines = tokenRegistry
            ? `- **Token Detail**: ${effectiveTokenDetail}
- **Token Set**: ${tokenRegistry.tokenSetId || 'Not configured'}
- **Design Token Dir**: ${tokenRegistry.designTokenDir || 'Not configured'}
- **Token File**: ${tokenRegistry.sourceFile || 'Not configured'}
- **CSS Variable Metadata**: ${tokenRegistry.cssVariablesFile || 'Not configured'}
- **Remote Variable Alias Map**: ${tokenRegistry.variableAliasFile || 'Not configured'}`
            : `- **Token Resolution**: disabled
- **Reason**: no usable design token registry is configured`;

          const tokenGuidanceSection = tokenRegistry
            ? `### Token Usage Summary
- **Resolved token bindings**: ${tokenUsageSummary.bindingCount}
- **Token gaps**: ${tokenUsageSummary.gapCount}
- **Can generate code**: ${canGenerateCode ? 'yes' : 'no'}
- **Can generate token-pure code**: ${canGenerateTokenPureCode ? 'yes' : 'no'}
${tokenUsageSummary.warnings.length > 0 ? `- **Warnings**:
${tokenUsageSummary.warnings.map((warning) => `  - ${warning}`).join('\n')}` : '- **Warnings**: none'}

### Token/CSS Variable Contract
- Treat \`value\`, \`codeValue\`, layout padding/gap values, border radius values, and text style values that contain \`var(--...)\` as the implementation-ready CSS values.
- When a field has \`token\` or \`tokenBindings\`, use the emitted \`codeValue\` / \`value\` exactly in generated styles.
- Do not replace token-backed \`var(--...)\` values with \`color\`, \`resolvedValue\`, \`literalFallback\`, or hard-coded hex/px values.
- Use \`literalFallback\` only when there is no token-backed \`value\`, no matching \`token\`, and no usable \`tokenBindings\` entry for that property.
- Raw \`color\` objects and \`resolvedValue\` are for visual understanding only; they are not the preferred code output when a CSS variable is available.`
            : `### Token Resolution
- Token resolution is disabled because no usable design token registry is configured.
- The JSON omits \`tokenBindings\` and \`tokenGaps\`; generate from the simplified design structure and literal style values.`;

          const designTokenInstructions = tokenRegistry
            ? `2. **Use Design Tokens**:
   ${strategyInstructions}`
            : `2. **Use Design Values**: Token resolution is disabled, so use the simplified JSON style values directly.`;

          const styleGenerationInstruction = tokenRegistry
            ? `   - For design-system values, use token-backed \`var(--...)\` values from \`value\`, \`codeValue\`, or \`tokenBindings\`; do not use hard-coded Figma literals when a token-backed value exists.
   - If a property includes both a literal field such as \`color\` / \`literalFallback\` and a token-backed \`value\`, generate CSS from the token-backed \`value\`.`
            : `   - Token resolution is disabled for this response; do not invent token names or CSS variables.`;

          // Return combined result with simplified instructions for AI agent
          return {
            content: [
              {
                type: 'text',
                text: `# Figma Design Data

## Context
You are an AI agent. Convert the following Figma design into high-quality, production-ready code.

### File Information
- **File Key**: ${fileKey}
- **Node ID**: ${nodeId}
- **Source URL**: ${figmaNodeUrl}
- **Style Strategy**: ${effectiveStyleStrategy}
- **Include Raw Bound Variables**: ${shouldIncludeVariables ? 'yes' : 'no'}
- **Include Vector Paths**: ${shouldIncludeVectorPaths ? 'yes' : 'no'}
${tokenMetadataLines}

${tokenGuidanceSection}

### Rendered Design Image
${imageUrl ? `
<img src="${imageUrl}">

**Direct Image URL**: ${imageUrl}` : '⚠️ No image URL available - analyze the node data structure below'}

### Node Structure Data (Simplified)
The following JSON contains the essential Figma node structure for code conversion. Use this as your primary source for layout, spacing, and styling details.

\`\`\`json
${nodeDataJson}
\`\`\`

---

## Instructions

1. **Analyze Design**: Use the image and JSON data to understand the hierarchy, layout, and intent.
${designTokenInstructions}
3. **Generate Code**:
   - Generate code using the component library, framework, styling system, and coding conventions already present in the target project or loaded agent skills.
${styleGenerationInstruction}
   - Ensure the code is responsive and accessible.
4. **Output Format**:
   - Output the complete implementation shape required by the target project, such as Vue/React component code, styles, i18n keys, or supporting configuration when needed.
   - Do not introduce Tailwind CSS, CDN assets, or external imports unless the target project already uses them or the user explicitly requests them.`,
              },
            ],
          };

        } catch (error) {
          console.error(`Error fetching Figma node: ${error}`);
          return {
            content: [
              {
                type: 'text',
                text: `Error fetching Figma node: ${error instanceof Error ? error.message : String(error)}

Please check:
1. Your FIGMA_ACCESS_TOKEN is valid
2. The Figma URL is correct
3. You have access to the Figma file`,
              },
            ],
          };
        }
      }
    );
};

// Start server based on transport mode
if (TRANSPORT_MODE === 'stdio') {
  // Standard I/O mode for local development and CLI integrations
  console.error('Starting figma-context-mcp in stdio mode...');
  
  const server = new McpServer({
    name: "figma-context-mcp",
    version: "1.0.0",
  }, {
    capabilities: {
      resources: {},
      tools: {},
    }
  });

  setupServer(server);

  const transport = new StdioServerTransport();
  server.connect(transport).catch((error) => {
    console.error('Failed to connect stdio transport:', error);
    process.exit(1);
  });

  console.error('figma-context-mcp running in stdio mode');
  console.error('Ready to accept requests via standard I/O');
  
} else if (TRANSPORT_MODE === 'http') {
  // HTTP Streamable mode for server/production deployments
  console.error(`Starting figma-context-mcp in HTTP mode on port ${PORT}...`);
  
  ExpressHttpStreamableMcpServer(
    {
      name: "figma-context-mcp",
    },
    setupServer
  );
  
  console.error(`figma-context-mcp running in HTTP mode`);
  console.error(`Server listening on http://localhost:${PORT}`);
  console.error(`Health check: http://localhost:${PORT}/health`);
  console.error(`MCP endpoint: http://localhost:${PORT}/mcp`);
  
} else {
  console.error(`Invalid transport mode: ${TRANSPORT_MODE}`);
  console.error('Valid modes: stdio, http');
  process.exit(1);
}
