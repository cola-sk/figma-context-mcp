# Figma Context MCP Overview

Figma Context MCP extracts Figma node context for AI agents. The active runtime fetches node JSON and rendered images, removes noisy/default fields, and returns simplified JSON for page generation or component-library reasoning.

## Active Runtime Flow

1. Receive a Figma node URL.
2. Fetch Figma node JSON through the Figma API.
3. Fetch a rendered image URL through the Figma image API.
4. Simplify the node JSON by trimming invalid, empty, hidden, or default fields.
5. Return the simplified JSON and image URL to the agent.

Automatic component matching is not implemented in the MCP runtime yet. Agents should use the returned structure together with project skills or component catalogs.

## Active Tool

| Tool | Purpose |
| --- | --- |
| `convert-figma-to-code` | Fetch a Figma node, render a preview image, and return simplified node JSON using literal design values. |

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

The repository also contains component mapping assets and scripts. These support the Dashboard and future mapping workflows, but are separate from the active MCP node-extraction path.

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
