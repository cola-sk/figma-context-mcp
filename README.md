# Figma Context MCP

MCP server for extracting Figma design context for AI agents.

The active runtime focuses on one stable responsibility: fetch Figma node data and image previews, trim noisy or invalid fields, and return simplified JSON that an agent can use to generate pages or map design elements to component-library primitives.

Component mapping assets and scripts live in this repo because they are part of the same workflow, but component matching logic is not baked into the MCP runtime yet. The Dashboard is a companion UI for reviewing generated mapping files; its usage docs live in [app/README.md](app/README.md).

## Core Flow

```text
Figma node URL
  -> convert-figma-to-code
  -> simplified JSON + rendered image URL
  -> agent uses project skills/component catalog to generate UI
```

Component mapping data is maintained separately:

```text
Figma plugin export
  -> assets/{d,b}-components/all.json
  -> pnpm map:generate
  -> assets/mappings/{d,b}-figma-component-key-map.json
```

## MCP Server

The active MCP tool is:

| Tool | Purpose |
| --- | --- |
| `convert-figma-to-code` | Fetch a Figma node, render a preview image, and return simplified node JSON using literal design values. |

Current runtime does not enable design token resolution or automatic component matching. It only requires Figma API access.

## MCP Config

GitHub Copilot / VS Code:

```json
{
  "servers": {
    "figma-context-mcp": {
      "type": "stdio",
      "command": "figma-context-mcp",
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

Claude Desktop / Cursor:

```json
{
  "mcpServers": {
    "figma-context-mcp": {
      "type": "stdio",
      "command": "figma-context-mcp",
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

Local build:

```json
{
  "mcpServers": {
    "figma-context-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/figma-mcp/build/index.js"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

Do not configure `TI_DESIGN_TOKEN_DIR`, `TI_TOKEN_SET`, or `.figma-context-mcp.json` for the current runtime.

## Component Mapping Assets

These files support the mapping workflow and Dashboard. They are not required for basic `convert-figma-to-code` node extraction.

Plugin exports:

```text
assets/d-components/
assets/b-components/
```

Generated maps:

```text
assets/mappings/d-figma-component-key-map.json
assets/mappings/b-figma-component-key-map.json
```

Regenerate maps:

```bash
pnpm map:generate
```

`pnpm map:generate` seeds from existing d/b map files first, then falls back to `assets/mappings/figma-component-key-map.json`. It preserves reviewed mapping data by matching entries by `figma.key`, then `figma.id`, then `page + name`.

## Preview Export

Preview export is a repository script, but the generated assets are served by the Dashboard app.

```bash
export FIGMA_ACCESS_TOKEN="YOUR_FIGMA_TOKEN"
pnpm previews:export -- --system d --all --delay-ms 500
```

Common variants:

```bash
pnpm previews:export -- --system d --name Button
pnpm previews:export -- --system d --key <componentKey>
pnpm previews:export -- --system d --name Button --variants false
```

## Development

```bash
npm run build
npm start
npm run dev
npm run inspector
```

HTTP mode:

```bash
npm run start:http
```

Dashboard:

```bash
pnpm map-viewer:dev
pnpm map-viewer:build
```

## Future Token Capability

Design token resolution was intentionally removed from the active runtime path and archived for future use:

```text
docs/future-token-capability/
```

That folder contains the previous token resolver code, project config resolver, previous MCP resource docs, and restore notes. Future token work should start there instead of reintroducing token logic directly into the current simplified JSON path.

## Project Structure

```text
figma-context-mcp/
├── src/                         # MCP server runtime
├── data/                        # MCP resource docs
├── scripts/                     # map / preview generation scripts
├── assets/                      # plugin exports and generated mapping JSON
├── app/                         # Component Map Viewer Dashboard
├── docs/future-token-capability/
├── build/
└── package.json
```

## License

MIT
