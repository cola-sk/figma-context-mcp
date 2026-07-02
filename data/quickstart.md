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
- `tiComponent` hints for INSTANCE nodes when a component map is configured;
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

## Enable Component Hints

Create `.figma-context-mcp.json` in the business project root:

```json
{
  "componentMap": {
    "source": "d",
    "inject": true
  }
}
```

The MCP discovers the project root in this order, no `cwd` configuration required on supporting clients (Claude Code, Cursor, etc.):

1. **MCP `roots`** — the client advertises the active workspace, and the server queries it on each request.
2. **`FIGMA_CONTEXT_MCP_PROJECT_ROOT` env var** — use this when the client does not support `roots`.
3. **`process.cwd()`** — fallback when the MCP is launched from the project root.

For clients without `roots` support, set `FIGMA_CONTEXT_MCP_PROJECT_ROOT` or launch the MCP with the business project as the working directory.

Use `"source": "b"` for the internal public Titan Design System, `"source": "d"` for the theme developer platform Design System, `"source": "none"` to disable hints, or `"source": "auto"` to auto-detect only when the requested Figma file is one of the library files.

When hints are enabled, INSTANCE nodes include:

| Field | Meaning |
| --- | --- |
| `tiComponent.status` | `mapped`, `unmapped`, or `internal`. |
| `tiComponent.library` / `component` | The component library and component name to use when mapped. |
| `tiComponent.sourceStatus` | Original map status, such as `unresolved` or `not-found`. |
| `tiComponent.variantProps` | Always `null`; prop mapping is intentionally not inferred. |

If `status` is `unmapped` or `internal`, the agent should surface that result and avoid inventing a look-alike component.

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
