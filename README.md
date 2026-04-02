# figma-context-mcp

An [MCP server](https://modelcontextprotocol.io/) that enables AI assistants to convert Figma designs to production-ready frontend code. Simply provide a Figma node URL and get clean HTML markup with Tailwind CSS.

## Features

- **Figma to Code** - Convert Figma designs to clean HTML + Tailwind CSS
- **Figma API Integration** - Extracts layout, colors, typography, spacing, and effects from Figma nodes
- **Dual Transport** - Works with stdio (Claude Desktop, Cursor) and HTTP server mode

## Quickstart

### 1. Install

**Global install (recommended):**
```bash
npm install -g @sking7/figma-context-mcp --registry=https://registry.npmjs.org/
```

**Or clone and build locally:**
```bash
git clone https://github.com/cola-sk/figma-mcp.git
cd figma-context-mcp
npm install
npm run build
```

### 2. Set your Figma access token

Get your [Figma personal access token](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens), then configure your MCP client.

#### GitHub Copilot (VS Code)

Edit `.vscode/mcp.json` in your project root:
```json
{
  "servers": {
    "figma-context-mcp": {
      "type": "stdio",
      "command": "figma-context-mcp",
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_PERSONAL_FIGMA_ACCESS_TOKEN"
      }
    }
  }
}
```

#### Claude Desktop

Edit `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "figma-context-mcp": {
      "type": "stdio",
      "command": "figma-context-mcp",
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_PERSONAL_FIGMA_ACCESS_TOKEN"
      }
    }
  }
}
```

#### Cursor

Edit `mcp.json`:
```json
{
  "mcpServers": {
    "figma-context-mcp": {
      "type": "stdio",
      "command": "figma-context-mcp",
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_PERSONAL_FIGMA_ACCESS_TOKEN"
      }
    }
  }
}
```

### 3. Usage

Paste a Figma node URL into your AI assistant:

```
Convert this Figma design: https://www.figma.com/design/FILE_KEY/MyFile?node-id=123-456
```

The assistant will fetch the design data and generate clean HTML + Tailwind CSS code.

## Development

### Local setup

```bash
git clone https://github.com/cola-sk/figma-mcp.git
cd figma-context-mcp
npm install
npm run build
npm start
```

### Run modes

**stdio mode (Claude Desktop / Cursor):**
```bash
npm start
```

**HTTP server mode:**
```bash
npm start -- --mode http --port 3000
```

Server available at `http://localhost:3000/mcp`.

### MCP Inspector

```bash
npm run inspector
```

## Project structure

```
figma-context-mcp/
├── src/
│   ├── index.ts              # Main entry point & MCP tool definitions
│   └── server-runner.ts      # HTTP transport (Express)
├── data/
│   ├── overview.md           # Server overview resource
│   └── quickstart.md         # Quickstart guide resource
├── build/                    # Compiled output
└── package.json
```

## License

MIT
