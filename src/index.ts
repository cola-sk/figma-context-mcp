#!/usr/bin/env node
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { ExpressHttpStreamableMcpServer } from "./server-runner.js";
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ComponentMap, ComponentMapResolution } from './component-map.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const getDefaultIncludeVariables = (): boolean =>
  process.env.FIGMA_INCLUDE_VARIABLES === '1'
  || process.env.FIGMA_INCLUDE_VARIABLES === 'true';

const getDefaultIncludeVectorPaths = (): boolean =>
  process.env.FIGMA_INCLUDE_VECTOR_PATHS === '1'
  || process.env.FIGMA_INCLUDE_VECTOR_PATHS === 'true';

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

const formatFigmaColor = (color: any): string | undefined => {
  if (!color || typeof color !== 'object') return undefined;
  if (typeof color.r !== 'number' || typeof color.g !== 'number' || typeof color.b !== 'number') return undefined;

  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = typeof color.a === 'number' ? Math.round(color.a * 100) / 100 : 1;

  return a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
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

const formatComponentMapSection = (resolution: ComponentMapResolution): string => {
  if (resolution.status === 'disabled') {
    return '';
  }

  const warnings = resolution.configContext.warnings.length > 0
    ? `\n- **Warnings**: ${resolution.configContext.warnings.join('; ')}`
    : '';

  if (resolution.status === 'loaded' && resolution.componentMap) {
    const summary = resolution.componentMap.summary;
    const configStatus = resolution.configContext.configPath ? 'found' : 'not found; auto-detected from requested library file';
    const fileName = summary.fileName ? ` (${summary.fileName})` : '';
    return `\n## Component Map\n- **Source**: ${summary.source}${fileName}\n- **Library fileKey**: ${summary.fileKey ?? 'unknown'}\n- **Coverage**: ${summary.mapped} mapped / ${summary.unmapped} unmapped / ${summary.internal} internal\n- **Config**: ${configStatus}\n- **Policy**: ${summary.policy}${warnings}\n`;
  }

  if (resolution.status === 'auto-unmatched') {
    return `\n## Component Map Notice\n${resolution.message} tiComponent hints are NOT injected.\n\nTo enable component hints, create .figma-context-mcp.json in your project root:\n\n\`\`\`json\n{ "componentMap": { "source": "b" } }\n\`\`\`\n\nor:\n\n\`\`\`json\n{ "componentMap": { "source": "d" } }\n\`\`\`${warnings}\n`;
  }

  return `\n## Component Map Notice\n${resolution.message} tiComponent hints are NOT injected.${warnings}\n`;
};

const formatComponentMapSummaryResource = (resolution: ComponentMapResolution): string => {
  if (resolution.status === 'loaded' && resolution.componentMap) {
    const summary = resolution.componentMap.summary;
    return `# Component Map Summary\n\n- Source: ${summary.source}\n- Library fileKey: ${summary.fileKey ?? 'unknown'}\n- Library fileName: ${summary.fileName ?? 'unknown'}\n- Coverage: ${summary.mapped} mapped / ${summary.unmapped} unmapped / ${summary.internal} internal\n- Config: ${resolution.configContext.configPath ? 'found' : 'not found; auto-detected only for library-file requests'}\n- Policy: ${summary.policy}\n`;
  }

  if (resolution.status === 'disabled') {
    return '# Component Map Summary\n\nComponent map injection is disabled by project configuration.\n';
  }

  return `# Component Map Summary\n\nNo component map is currently loaded.\n\nStatus: ${resolution.status}\nReason: ${resolution.message}\n`;
};

// Function to setup all resources and tools
const setupServer = (server: McpServer) => {

    const resolveProjectCandidates = async (): Promise<string[]> => {
      const candidates: string[] = [];

      // 1) MCP roots — the client tells us the active workspace(s).
      try {
        const result = await server.server.listRoots();
        for (const root of result?.roots ?? []) {
          if (!root?.uri) continue;
          try {
            const url = new URL(root.uri);
            if (url.protocol !== 'file:') continue;
            const path = fileURLToPath(url);
            if (!candidates.includes(path)) {
              candidates.push(path);
            }
          } catch {
            // ignore malformed root URIs
          }
        }
      } catch {
        // Client doesn't support roots or isn't connected yet — fall through.
      }

      // 2) Explicit env override (useful when roots unavailable).
      if (process.env.FIGMA_CONTEXT_MCP_PROJECT_ROOT) {
        if (!candidates.includes(process.env.FIGMA_CONTEXT_MCP_PROJECT_ROOT)) {
          candidates.push(process.env.FIGMA_CONTEXT_MCP_PROJECT_ROOT);
        }
      }

      // 3) Fallback to process.cwd() (works when client launches MCP from project root).
      const cwd = process.cwd();
      if (!candidates.includes(cwd)) {
        candidates.push(cwd);
      }

      return candidates;
    };

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

    server.resource(
      "figma_component_map_summary",
      "figma://component-map/summary",
      {
        description: "Summary of the configured Figma component map used for tiComponent hints.",
        title: "Component Map Summary",
        mimeType: "text/markdown",
      },
      async (uri) => {
        const candidates = await resolveProjectCandidates();
        const resolution = ComponentMap.resolveForRequest({
          cwd: candidates,
          requestFileKey: null,
        });

        return {
          contents: [
            {
              uri: uri.href,
              text: formatComponentMapSummaryResource(resolution),
              mimeType: "text/markdown",
            },
          ],
        };
      }
    );

    server.tool(
      'convert-figma-to-code',
      'Fetches a Figma node and rendered image from the Figma API and returns simplified code generation context.',
      {
        figmaNodeUrl: z.string().describe('The URL of the Figma node (e.g., https://www.figma.com/design/fileKey/fileName?node-id=123-456)'),
        includeVariables: z.boolean().optional().describe('Includes compact raw Figma boundVariables in the simplified JSON for debugging. Defaults to FIGMA_INCLUDE_VARIABLES.'),
        includeVectorPaths: z.boolean().optional().describe('Whether to request and include raw vector path data. Defaults to FIGMA_INCLUDE_VECTOR_PATHS.'),
      },
      async ({
        figmaNodeUrl,
        includeVariables,
        includeVectorPaths,
      }: {
        figmaNodeUrl: string;
        includeVariables?: boolean;
        includeVectorPaths?: boolean;
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

          const shouldIncludeVariables = includeVariables ?? getDefaultIncludeVariables();
          const shouldIncludeVectorPaths = includeVectorPaths ?? getDefaultIncludeVectorPaths();

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

          const componentMapResolution = ComponentMap.resolveForRequest({
            cwd: await resolveProjectCandidates(),
            requestFileKey: fileKey,
          });
          const componentMap = componentMapResolution.componentMap;
          const componentMapSection = formatComponentMapSection(componentMapResolution);

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
          const simplifyNode = (
            node: any,
            parentBounds?: any,
            parentLayoutMode?: string,
            componentsById?: Record<string, any>,
          ): any => {
            if (!node) return null;
            if (node.visible === false) return null;
            
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

            if (
              node.type === 'INSTANCE'
              && typeof node.componentId === 'string'
              && componentMap
            ) {
              const rawKey = typeof componentsById === 'object' && componentsById !== null
                ? componentsById[node.componentId]?.key
                : undefined;
              const figmaKey = typeof rawKey === 'string' && rawKey.length > 0 ? rawKey : null;
              const lookupKey = figmaKey ?? node.componentId;
              simplified.tiComponent = componentMap.resolveByComponentKey(lookupKey);
            }

            if (shouldIncludeVariables) {
              copyFields(['boundVariables', 'explicitVariableModes']);
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
                  top: node.paddingTop,
                  right: node.paddingRight,
                  bottom: node.paddingBottom,
                  left: node.paddingLeft,
                } : undefined,
                gap: node.itemSpacing,
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
              simplified.borderRadius = node.cornerRadius;
            } else if (node.rectangleCornerRadii) {
              simplified.borderRadius = node.rectangleCornerRadii;
            }
            if (node.cornerSmoothing !== undefined && node.cornerSmoothing !== 0) {
              simplified.cornerSmoothing = node.cornerSmoothing;
            }

            // Add fills (background colors)
            if (node.fills && node.fills.length > 0) {
              simplified.fills = node.fills
                .filter((fill: any) => fill.visible !== false)
                .map((fill: any) => {
                  const literalColor = formatFigmaColor(fill.color);
                  const normalizedFill = normalizeDesignValue(fill, shouldIncludeVariables) as Record<string, unknown>;

                  return cleanObject({
                    ...normalizedFill,
                    value: literalColor,
                  });
                });
            }

            // Add strokes (borders)
            if (node.strokes && node.strokes.length > 0) {
              simplified.strokes = node.strokes
                .filter((stroke: any) => stroke.visible !== false)
                .map((stroke: any) => {
                  const literalColor = formatFigmaColor(stroke.color);
                  const normalizedStroke = normalizeDesignValue(stroke, shouldIncludeVariables) as Record<string, unknown>;

                  return cleanObject({
                    ...normalizedStroke,
                    value: literalColor,
                  });
                });
              if (typeof node.strokeWeight === 'number') {
                simplified.strokeWeight = node.strokeWeight;
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
                    radius: effect.radius,
                    color: formatFigmaColor(effect.color),
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
                  fontWeight: node.style.fontWeight,
                  fontSize: node.style.fontSize,
                  lineHeight: node.style.lineHeightPx,
                  letterSpacing: node.style.letterSpacing,
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
                .map((child: any) => simplifyNode(child, node.absoluteBoundingBox, node.layoutMode, componentsById))
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
                document: simplifyNode(node.document, undefined, undefined, node.components),
                components: slimComponents(node.components),
                componentSets: slimComponentSets(node.componentSets),
                styles: slimStyles(node.styles),
              });
              return acc;
            }, {})
            : simplifyNode(nodeData);

          const prettyNodeData = JSON.stringify(simplifiedNodeData, null, 2);
          const nodeDataJson = prettyNodeData.length > 200000
            ? JSON.stringify(simplifiedNodeData)
            : prettyNodeData;

          // Return combined result with simplified instructions for AI agent
          return {
            content: [
              {
                type: 'text',
                text: `# Figma Design Data
${componentMapSection}

## Context
You are an AI agent. Convert the following Figma design into high-quality, production-ready code.

### File Information
- **File Key**: ${fileKey}
- **Node ID**: ${nodeId}
- **Source URL**: ${figmaNodeUrl}
- **Include Raw Bound Variables**: ${shouldIncludeVariables ? 'yes' : 'no'}
- **Include Vector Paths**: ${shouldIncludeVectorPaths ? 'yes' : 'no'}

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
2. **Use Design Values**: Use the simplified JSON style values directly.
3. **Generate Code**:
   - Generate code using the component library, framework, styling system, and coding conventions already present in the target project or loaded agent skills.
   - Preserve spacing, sizing, color, radius, typography, and interaction states from the simplified data.
   - Ensure the code is responsive and accessible.
4. **Output Format**:
   - Output the complete implementation shape required by the target project, such as Vue/React component code, styles, i18n keys, or supporting configuration when needed.
   - Do not introduce Tailwind CSS, CDN assets, or external imports unless the target project already uses them or the user explicitly requests them.
5. **Component Hints**: If a node carries \`tiComponent\`, you MUST use that exact component (\`tiComponent.library\` / \`tiComponent.component\`). Invoke the \`ti-component-skills\` skill to look up its API/props. Map Figma \`componentProperties\` to the component props yourself; the map intentionally does not provide prop mapping. If \`tiComponent.status\` is \`"unmapped"\` or \`"internal"\`, declare the node as unmapped to the user and do not hand-roll a look-alike. If no \`tiComponent\` field appears on any node, see the Component Map / Component Map Notice section at the top of this output.`,
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
