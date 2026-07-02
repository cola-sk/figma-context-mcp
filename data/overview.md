# Figma Context MCP Overview

Figma Context MCP extracts Figma node context for AI agents. The active runtime fetches node JSON and rendered images, removes noisy/default fields, and returns simplified JSON for page generation or component-library reasoning.

## Active Runtime Flow

1. Receive a Figma node URL.
2. Fetch Figma node JSON through the Figma API.
3. Fetch a rendered image URL through the Figma image API.
4. Simplify the node JSON by trimming invalid, empty, hidden, or default fields.
5. Optionally inject `tiComponent` hints for Figma INSTANCE nodes when a local component map is configured.
6. Return the simplified JSON and image URL to the agent.

Component hints are identity-only. They tell the agent which TiComponents or Element Plus component to use, but they do not infer prop mappings from Figma variants.

## Active Tool

| Tool | Purpose |
| --- | --- |
| `convert-figma-to-code` | Fetch a Figma node, render a preview image, and return simplified node JSON using literal design values. |

## Component Hints

Business projects can enable component hints with a `.figma-context-mcp.json` file in the project root:

```json
{
  "componentMap": {
    "source": "d",
    "inject": true
  }
}
```

Supported sources are `b`, `d`, `auto`, and `none`. When enabled, each Figma INSTANCE with a `componentId` receives a `tiComponent` field:

```json
{
  "status": "mapped",
  "library": "Element Plus",
  "component": "el-button",
  "variantProps": null
}
```

`status: "unmapped"` means the agent must surface the missing mapping and must not hand-roll a look-alike component from visuals. Use `figma://component-map/summary` to inspect the configured map.

## Simplified JSON

The tool does not return raw Figma API JSON. It trims empty/default values and normalizes common fields so the output is easier to inspect.

| Type | Rule |
| --- | --- |
| Empty/default values | Remove `null`, `undefined`, empty arrays, empty objects, and default values such as `opacity: 1`. |
| Paint arrays | Remove hidden fills, strokes, and effects. |
| Colors | Convert Figma 0-1 RGB values into hex or rgba strings where useful. |
| Raw variables | Strip `boundVariables` and `explicitVariableModes` by default. |
| Vector paths | Omit by default unless `includeVectorPaths` is enabled. |
| Top-level maps | Keep only compact component, component set, and style metadata. |

## Component Mapping Assets

The repository also contains component mapping assets and scripts. The MCP runtime can consume generated maps locally when `.figma-context-mcp.json` enables a source.

Generated map files:

```text
figma-component-assets-private/mappings/d-figma-component-key-map.json
figma-component-assets-private/mappings/b-figma-component-key-map.json
```

Offline preview files:

```text
figma-component-assets-private/previews/{system}/
figma-component-assets-private/previews/{system}/index.json
```

## Archived Token Work

The previous design token implementation has been archived under:

```text
docs/future-token-capability/
```

It is intentionally not compiled into the current runtime.
