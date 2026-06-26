#!/usr/bin/env node
import { z } from 'zod';
import { isInitializeRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { ExpressHttpStreamableMcpServer } from "./server-runner.js";
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      'Fetches a Figma node and its rendered image from the Figma API and converts it to a code block. Requires FIGMA_ACCESS_TOKEN environment variable to be set.',
      {
        figmaNodeUrl: z.string().describe('The URL of the Figma node (e.g., https://www.figma.com/design/fileKey/fileName?node-id=123-456)'),
      },
      async ({ figmaNodeUrl }): Promise<CallToolResult> => {
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
          const nodeApiUrl = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`;
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
          const simplifyNode = (node: any): any => {
            if (!node) return null;
            
            const simplified: any = {
              type: node.type,
              name: node.name,
            };

            // Add dimensions if available
            if (node.absoluteBoundingBox) {
              simplified.size = {
                width: Math.round(node.absoluteBoundingBox.width),
                height: Math.round(node.absoluteBoundingBox.height),
              };
            }

            // Add layout info for frames
            if (node.layoutMode) {
              simplified.layout = {
                mode: node.layoutMode, // HORIZONTAL, VERTICAL, NONE
                wrap: node.layoutWrap, // WRAP, NO_WRAP
                padding: node.paddingLeft || node.paddingTop ? {
                  top: node.paddingTop,
                  right: node.paddingRight,
                  bottom: node.paddingBottom,
                  left: node.paddingLeft,
                } : undefined,
                gap: node.itemSpacing,
                align: node.primaryAxisAlignItems,
                justify: node.counterAxisAlignItems,
              };
            }

            // Add child sizing behavior within parent auto-layout (HUG / FILL / FIXED)
            if (node.layoutSizingHorizontal || node.layoutSizingVertical) {
              simplified.sizing = {
                horizontal: node.layoutSizingHorizontal,
                vertical: node.layoutSizingVertical,
              };
            }

            // Add positioning mode within parent auto-layout (AUTO / ABSOLUTE)
            if (node.layoutPositioning && node.layoutPositioning !== 'AUTO') {
              simplified.positioning = node.layoutPositioning;
              // Include coordinates for absolutely positioned nodes
              if (node.absoluteBoundingBox) {
                simplified.position = {
                  x: Math.round(node.absoluteBoundingBox.x),
                  y: Math.round(node.absoluteBoundingBox.y),
                };
              }
            }

            // Add corner radius
            if (node.cornerRadius) {
              simplified.borderRadius = node.cornerRadius;
            } else if (node.rectangleCornerRadii) {
              simplified.borderRadius = node.rectangleCornerRadii;
            }

            // Add fills (background colors)
            if (node.fills && node.fills.length > 0) {
              simplified.fills = node.fills
                .filter((fill: any) => fill.visible !== false)
                .map((fill: any) => ({
                  type: fill.type,
                  color: fill.color ? {
                    r: Math.round(fill.color.r * 255),
                    g: Math.round(fill.color.g * 255),
                    b: Math.round(fill.color.b * 255),
                    a: fill.color.a !== undefined ? Math.round(fill.color.a * 100) / 100 : 1,
                  } : undefined,
                  opacity: fill.opacity,
                }));
            }

            // Add strokes (borders)
            if (node.strokes && node.strokes.length > 0) {
              simplified.strokes = node.strokes
                .filter((stroke: any) => stroke.visible !== false)
                .map((stroke: any) => ({
                  type: stroke.type,
                  color: stroke.color ? {
                    r: Math.round(stroke.color.r * 255),
                    g: Math.round(stroke.color.g * 255),
                    b: Math.round(stroke.color.b * 255),
                  } : undefined,
                }));
              if (node.strokeWeight) {
                simplified.strokeWeight = node.strokeWeight;
              }
            }

            // Add effects (shadows, blur)
            if (node.effects && node.effects.length > 0) {
              simplified.effects = node.effects
                .filter((effect: any) => effect.visible !== false)
                .map((effect: any) => ({
                  type: effect.type,
                  radius: effect.radius,
                  offset: effect.offset,
                  color: effect.color ? {
                    r: Math.round(effect.color.r * 255),
                    g: Math.round(effect.color.g * 255),
                    b: Math.round(effect.color.b * 255),
                    a: Math.round(effect.color.a * 100) / 100,
                  } : undefined,
                }));
            }

            // Add text-specific properties
            if (node.type === 'TEXT') {
              simplified.text = node.characters;
              if (node.style) {
                simplified.textStyle = {
                  fontFamily: node.style.fontFamily,
                  fontWeight: node.style.fontWeight,
                  fontSize: node.style.fontSize,
                  lineHeight: node.style.lineHeightPx,
                  letterSpacing: node.style.letterSpacing,
                  textAlign: node.style.textAlignHorizontal,
                };
              }
            }

            // Recursively process children
            if (node.children && node.children.length > 0) {
              simplified.children = node.children.map(simplifyNode).filter(Boolean);
            }

            return simplified;
          };

          // Simplify the node data
          const simplifiedNodeData = nodeData.nodes ? 
            Object.keys(nodeData.nodes).reduce((acc: any, key: string) => {
              const node = nodeData.nodes[key];
              acc[key] = {
                document: simplifyNode(node.document),
                components: node.components ? Object.keys(node.components).length + ' components' : undefined,
                styles: node.styles ? Object.keys(node.styles).length + ' styles' : undefined,
              };
              return acc;
            }, {}) 
            : simplifyNode(nodeData);

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

### Rendered Design Image
${imageUrl ? `
<img src="${imageUrl}">

**Direct Image URL**: ${imageUrl}` : '⚠️ No image URL available - analyze the node data structure below'}

### Node Structure Data (Simplified)
The following JSON contains the essential Figma node structure for code conversion. Use this as your primary source for layout, spacing, and styling details.

\`\`\`json
${JSON.stringify(simplifiedNodeData, null, 2)}
\`\`\`

---

## Instructions

1. **Analyze Design**: Use the image and JSON data to understand the hierarchy, layout, and intent.
2. **Generate Code**:
   - Use Tailwind CSS utility classes.
   - Ensure the code is responsive and accessible.
3. **Output Format**:
   - ONLY output the component HTML markup.
   - NO \`<html>\`, \`<head>\`, or \`<body>\` tags.
   - NO external library imports (\`<link>\` or \`<script>\`).`,
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
