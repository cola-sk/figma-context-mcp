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

## Agent Integration

When an agent has a component-library skill installed (e.g., `ti-component-skills`), the workflow is:

- Agent receives Figma node context from this MCP tool
- Agent reads design structure (layout mode, spacing, element types)
- Agent uses `tokenBindings[].codeValue` for color, radius, spacing, stroke, shadow, and typography values
- Agent reports `tokenGaps` instead of generating final code with hard-coded values when `tokensOnly` is active
- Agent selects matching components from the skill's component catalog
- Agent produces complete, runnable page code (Vue 3, HTML, etc.)

No manual component lookup is needed — the design data and skill knowledge are combined automatically.
