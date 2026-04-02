# Flowbite MCP Server Overview

This MCP server is a **Figma-to-code bridge** for AI agents. It extracts structured design data from Figma and provides it as context so the agent can generate production-ready UI code using a company-specific component library (via agent `skills`).

## How It Works

1. **Design Extraction** — The `convert-figma-to-code` tool fetches a Figma node's structure (layout, dimensions, text, colors) and renders a visual preview image.
2. **Context Delivery** — The simplified JSON and image are passed to the agent as tool output, giving it a precise understanding of the design intent.
3. **Skill-Driven Code Generation** — The agent maps the extracted design elements to components defined in its loaded skill (e.g., `TiComponents`), and generates clean, framework-specific code.

This server does **not** bundle component source code. Component implementations are owned by the agent's skill layer.

## Key Capability

| Tool | Purpose |
|------|---------|
| `convert-figma-to-code` | Extract Figma node data + render preview image, return structured context for code generation |

## Agent Integration

When an agent has a component-library skill installed (e.g., `ti-component-skills`), the workflow is:

- Agent receives Figma node context from this MCP tool
- Agent reads design structure (layout mode, spacing, element types)
- Agent selects matching components from the skill's component catalog
- Agent produces complete, runnable page code (Vue 3, HTML, etc.)

No manual component lookup is needed — the design data and skill knowledge are combined automatically.