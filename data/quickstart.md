# Quickstart Guide

This guide covers the active Figma Context MCP workflow.

## Prerequisites

- `FIGMA_ACCESS_TOKEN` for Figma API access.
- Local dependencies installed.

## Call The MCP Tool

Use `convert-figma-to-code` with a Figma node URL:

```json
{
  "figmaNodeUrl": "https://www.figma.com/design/{fileKey}/My-Design?node-id=123-456"
}
```

The tool returns:

- rendered image URL;
- simplified node JSON;
- compact component / component set / style metadata when Figma returns it.

Optional debug flags:

```json
{
  "figmaNodeUrl": "https://www.figma.com/design/{fileKey}/My-Design?node-id=123-456",
  "includeVariables": true,
  "includeVectorPaths": false
}
```

## Use The Result

Use the simplified JSON to understand:

| Signal | Meaning |
| --- | --- |
| `layout.mode` | Auto-layout direction. |
| `layout.padding` / `layout.gap` | Spacing information. |
| `size` | Rounded node dimensions. |
| `fills` / `strokes` / `effects` | Visible paints and effects. |
| `textStyle` | Text style data for text nodes. |
| `components` / `componentSets` | Figma component metadata useful for component reasoning. |

Then let the agent combine this context with project skills or component catalogs to generate implementation code.

## Component Mapping Data

The repository also includes component mapping scripts and Dashboard assets. They are not required for basic MCP node extraction.

Place plugin exports in:

```text
figma-component-assets-private/d-components/
figma-component-assets-private/b-components/
```

Regenerate maps:

```bash
pnpm map:generate
```

Export D-side previews:

```bash
export FIGMA_ACCESS_TOKEN="YOUR_FIGMA_TOKEN"
pnpm previews:export -- --system d --all --delay-ms 500
```

## Dashboard

```bash
pnpm map-viewer:dev
```

```text
http://localhost:3217/?system=d
http://localhost:3217/?system=b
```

See `app/README.md` for Dashboard-specific workflows.
