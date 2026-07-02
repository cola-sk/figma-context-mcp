# Quickstart Guide

This guide explains how to use the `convert-figma-to-code` tool together with a component-library agent skill to produce page code from a Figma design.

## Prerequisites

- `FIGMA_ACCESS_TOKEN` environment variable set (Figma personal access token)
- Optional `TI_DESIGN_TOKEN_DIR` environment variable set to the absolute path of the `ti-d-design-token` repository when token-backed CSS variable output is needed
- Optional `TI_TOKEN_SET` environment variable set to `d`; defaults to `d`
- Optional `FIGMA_STYLE_STRATEGY` environment variable set to `tokensOnly` while testing token coverage
- Optional `FIGMA_TOKEN_DETAIL` environment variable set to `compact` or `full`; defaults to `compact`
- Optional `FIGMA_INCLUDE_VARIABLES` environment variable set to `true` while debugging raw Figma `boundVariables`
- Optional `FIGMA_INCLUDE_VECTOR_PATHS` environment variable set to `true` only when vector path data is needed
- Advanced override: `FIGMA_VARIABLES_TOKEN_FILE` and `FIGMA_CSS_VARIABLES_FILE` can still point directly to generated dist files
- A component-library skill loaded into the agent (e.g., `ti-component-skills`)

## Step-by-Step Workflow

### 1. Get a Figma Node URL

Open Figma, right-click on a frame or component, and copy the share link. It should look like:

```
https://www.figma.com/design/{fileKey}/My-Design?node-id=123-456
```

### 2. Call the Tool

Invoke `convert-figma-to-code` with the URL. The tool returns:

- **Image preview** — a rendered PNG of the selected node
- **Simplified JSON** — layout mode, dimensions, children, text content, token-aware style values, and fill info
- **Token bindings** — resolved Semantic or Component variables from Figma `boundVariables`, only when a token source is configured
- **Token gaps** — style properties that do not have a usable Semantic or Component variable, only when token resolution is enabled

Default token-first mode:

```json
{
  "figmaNodeUrl": "https://www.figma.com/design/{fileKey}/My-Design?node-id=123-456",
  "styleStrategy": "preferTokens",
  "tokenDetail": "compact"
}
```

Strict token-only mode:

```json
{
  "figmaNodeUrl": "https://www.figma.com/design/{fileKey}/My-Design?node-id=123-456",
  "styleStrategy": "tokensOnly"
}
```

### 3. Analyze the Design Context

Use the returned data to understand the structure:

| Signal | Meaning |
|--------|---------|
| `layoutMode: HORIZONTAL` | Row / flex-row container |
| `layoutMode: VERTICAL` | Column / flex-col container |
| `type: TEXT` | Label, heading, or paragraph |
| `tokenBindings[].codeValue` | The value the generated code should use for token-backed styles |
| `tokenGaps[]` | Missing Semantic or Component variable coverage; do not replace with hard-coded literals in `tokensOnly` mode |
| `type: RECTANGLE` + fills | Background card or image placeholder |
| `type: VECTOR` / `BOOLEAN_OPERATION` | Icon |

### 4. Map to Component Skill

With a skill like `ti-component-skills` active, match design elements to components

### 5. Generate Page Code

Produce framework-specific code (Vue 3 SFC, etc.) using matched components and token-backed style values.

Rules:

- Prefer `codeValue` from `tokenBindings`.
- If `cssVariable` is present, `codeValue` is already shaped like `var(--ti-d-*)`.
- If no CSS variable mapping exists yet, MCP reports a `tokenGap` so the agent does not silently invent a variable name.
- In `tokensOnly` mode, report `tokenGaps` before generating final code and do not substitute raw colors, px values, or guessed CSS variables.
- `Can generate code` means the active strategy allows code generation; `Can generate token-pure code` is `yes` only when there are zero `tokenGaps`.
- If no token source is configured, token resolution is disabled and MCP omits `tokenBindings` / `tokenGaps` entirely.
- Use `tokenDetail: "full"` only when debugging token reference, resolved value, or chain data; the default `compact` mode keeps CSS variable generation values while reducing prompt size.

## Important Notes

- This MCP tool provides **design context only**. Component implementations come entirely from the agent skill.
- When the Figma design contains elements with no direct component match, use the closest available component and adapt via props.
- Always prefer the component library's layout primitives (grid, stack, etc.) over writing raw CSS.
- Business code should use Semantic or Component token-backed CSS variables only.
