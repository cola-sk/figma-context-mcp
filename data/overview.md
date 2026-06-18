# Flowbite MCP Server Overview

This MCP server is a **Figma-to-code bridge** for AI agents. It extracts structured design data from Figma and provides it as context so the agent can generate production-ready UI code using a company-specific component library (via agent `skills`).

## How It Works

1. **Design Extraction** — The `convert-figma-to-code` tool fetches a Figma node's structure (layout, dimensions, text, colors) and renders a visual preview image.
2. **Token Resolution** — When a token source is configured, the tool reads `TI_DESIGN_TOKEN_DIR` and `TI_TOKEN_SET`, resolves the generated token files from the token repository manifest, resolves Figma `boundVariables`, and keeps only business-safe Semantic or Component variables for generated code.
3. **Context Delivery** — The simplified JSON and image are passed to the agent as tool output. When token resolution is enabled, compact `tokenBindings` and relevant `tokenGaps` are included as well; when no token source is configured, token metadata is omitted.
4. **Skill-Driven Code Generation** — The agent maps the extracted design elements to components defined in its loaded skill (e.g., `TiComponents`), and generates clean, framework-specific code using token-backed style values.

This server does **not** bundle component source code. Component implementations are owned by the agent's skill layer.

## Key Capability

| Tool | Purpose |
|------|---------|
| `convert-figma-to-code` | Extract Figma node data + render preview image + resolve Semantic or Component token bindings, return structured context for code generation |

## Style Strategies

| Strategy | Behavior |
|----------|----------|
| `preferTokens` | Prefer Semantic or Component token `codeValue` when available. Fall back to `literalFallback` only when no usable token is bound. |
| `tokensOnly` | Require Semantic or Component token-backed values for design-system styles. Missing bindings are returned as `tokenGaps`; agents should report the gaps before generating final code. |

The tool output separates `Can generate code` from `Can generate token-pure code`. `preferTokens` may still generate code with literal fallbacks when gaps exist, but any `tokenGaps` mean the output is not token-pure. `tokensOnly` treats token gaps as blockers.

## Token Detail

| Detail | Behavior |
|--------|----------|
| `compact` | Default. Keeps code-generation essentials: `sourcePath`, `property`, `cssVariable`, and `codeValue`. |
| `full` | Adds debugging metadata such as token references, resolved values, and chain information. |

## Simplified JSON — Field Trimming Reference

The tool does **not** return the raw Figma API JSON. It runs every node through a simplification pass before returning context. The table below lists every category of field that gets removed or transformed, the exact condition under which it applies, and the reason.

### Always-removed: empty / default values

| Field / Condition | When removed | Reason |
|---|---|---|
| Any field that is `null`, `undefined`, `[]`, or `{}` | Always | Removes noise from deeply nested objects |
| `opacity` | When value is `1` (Figma default) | Default; no CSS needed |
| `blendMode` | When value is `PASS_THROUGH` or `NORMAL` | Both are default blend modes |
| `constraints` | When `vertical = TOP` and `horizontal = LEFT` | Figma default; does not affect layout |
| `isMask` | When `false` | Default state |
| `rotation` | When absolute value ≤ 0.001° | Floating-point rounding artifact; effectively zero |
| `layoutPositioning` (`positioning` in output) | When value is `AUTO` | Default auto-layout positioning; non-`AUTO` is recorded as `positioning` |
| `cornerSmoothing` | When value is `0` | Default |
| `clipsContent` | When `false` | Default |

### Paint arrays (fills / strokes / effects)

| Condition | Behavior | Reason |
|---|---|---|
| `fill.visible === false` | Fill entry removed from array | Hidden paints do not affect rendered output |
| `stroke.visible === false` | Stroke entry removed from array | Same as above |
| `effect.visible === false` | Effect entry removed from array | Same as above |

### Color normalization

| Transformation | Reason |
|---|---|
| `r / g / b` floats (0.0 – 1.0) → integers (0 – 255) | Figma API encodes colors as fractions; integers are conventional for code generation |
| `a` preserved as a decimal rounded to 2 places | Keeps alpha readable without precision loss |

### Variable / token fields

| Field | Default behavior | How to override | Reason |
|---|---|---|---|
| `boundVariables` | **Stripped entirely** | Set `includeVariables: true` | Raw variable data is large; `tokenBindings` in the output already contains the resolved values |
| `explicitVariableModes` | **Stripped entirely** | Set `includeVariables: true` | Same |
| `boundVariables` entries (when `includeVariables: true`) | Each alias is compacted to `{ type, id }` only — all other fields removed | — | Alias metadata (name, description, etc.) is not needed; `tokenBindings` carries the human-readable info |

### Token bindings and gaps (only when token source is configured)

| Field | `compact` (default) | `full` | Reason fields are dropped in compact |
|---|---|---|---|
| `tokenBindings[]` | `sourcePath`, `property`, `cssVariable`, `codeValue` | + `reference`, `resolvedValue`, `resolvedType`, `chain` | Debugging metadata; not needed for code generation |
| `tokenGaps[]` | `sourcePath`, `property`, `reason` | + `variableName`, `collection` | Same |

Non-`Semantic` / non-`Component` variable bindings (e.g. `Primitive` collection) are **never** promoted to `tokenBindings`. They always appear as `tokenGaps` with `reason: "not a Semantic or Component variable"`. This enforces the rule that business code must reference only Semantic or Component tokens.

### Position field

`position` (relative x/y offset from parent) is **omitted** when the parent has auto-layout (`layoutMode = HORIZONTAL | VERTICAL`) **and** the node uses automatic positioning (`layoutPositioning = AUTO`). It is only included when the parent is not auto-layout, or when the node is explicitly absolutely positioned. Reason: in auto-layout, coordinates are controlled by the layout engine and hardcoding them in CSS would fight the layout.

### `literalFallback` in fills / strokes

The `literalFallback` field (raw hex / rgba color string) is **only included** when `styleStrategy = preferTokens`. It is **omitted entirely** when `styleStrategy = tokensOnly`. Reason: prevents agents from silently substituting a raw color when the intent is token-only output.

### Vector paths

`vectorPaths` is **stripped** unless `includeVectorPaths: true` (or `FIGMA_INCLUDE_VECTOR_PATHS=true`). Reason: path data is large and almost never needed for component-library code generation.

### Top-level component / style maps

The `components`, `componentSets`, and `styles` maps on each node response are trimmed to only `{ key, name, description, componentSetId, styleType }`. All other metadata (documentation links, remote flags, etc.) is dropped. Reason: only the name and key are needed for component mapping.

---

## Agent Integration

When an agent has a component-library skill installed (e.g., `ti-component-skills`), the workflow is:

- Agent receives Figma node context from this MCP tool
- Agent reads design structure (layout mode, spacing, element types)
- Agent uses `tokenBindings[].codeValue` for color, radius, spacing, stroke, shadow, and typography values
- Agent reports `tokenGaps` instead of generating final code with hard-coded values when `tokensOnly` is active
- Agent selects matching components from the skill's component catalog
- Agent produces complete, runnable page code (Vue 3, HTML, etc.)

No manual component lookup is needed — the design data and skill knowledge are combined automatically.
