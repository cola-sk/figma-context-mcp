# Quickstart Guide

This guide explains how to use the `convert-figma-to-code` tool together with a component-library agent skill to produce page code from a Figma design.

## Prerequisites

- `FIGMA_ACCESS_TOKEN` environment variable set (Figma personal access token)
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
- **Simplified JSON** — layout mode, dimensions, children, text content, colors, and fill info

### 3. Analyze the Design Context

Use the returned data to understand the structure:

| Signal | Meaning |
|--------|---------|
| `layoutMode: HORIZONTAL` | Row / flex-row container |
| `layoutMode: VERTICAL` | Column / flex-col container |
| `type: TEXT` | Label, heading, or paragraph |
| `type: RECTANGLE` + fills | Background card or image placeholder |
| `type: VECTOR` / `BOOLEAN_OPERATION` | Icon |

### 4. Map to Component Skill

With a skill like `ti-component-skills` active, match design elements to components

### 5. Generate Page Code

Produce framework-specific code (Vue 3 SFC, etc.) using only the matched components. Do not invent styles — rely on the component's built-in props and slots.

## Important Notes

- This MCP tool provides **design context only**. Component implementations come entirely from the agent skill.
- When the Figma design contains elements with no direct component match, use the closest available component and adapt via props.
- Always prefer the component library's layout primitives (grid, stack, etc.) over writing raw CSS.

Check out the JavaScript behaviour section of each component's page to learn how you can use this.

### TypeScript

Flowbite supports type declarations for the interactive UI components including object interfaces and parameter types. Check out the following examples to learn how you can use types with Flowbite.

Additionally to our code above, we will now import some relevant types from the Flowbite package, namely the `ModalOptions` and `ModalInterface`:

```javascript
import { Modal } from 'flowbite'
import type { ModalOptions, ModalInterface } from 'flowbite'

// other code
```