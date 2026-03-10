# Figma MCP

An [MCP server](https://modelcontextprotocol.io/) that enables AI assistants to convert Figma designs to high-quality frontend code. Simply provide a Figma node URL and get clean, production-ready HTML markup with Tailwind CSS.

## Features

- **🎨 Figma to Code** - Convert Figma designs to clean HTML + Tailwind CSS code
- **🔑 Figma API Integration** - Extracts layout, colors, typography, and effects from Figma designs
- **🚀 Dual Transport** - Works with stdio (Claude Desktop, Cursor) and HTTP server

## Quickstart

### 1. Build the project

```bash
git clone https://github.com/yourusername/figma-mcp.git
cd figma-mcp
npm install
npm run build
```

### 2. Set your Figma access token

Get your [Figma personal access token](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens) and update your MCP client configuration.

#### Claude Desktop

Update `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "figma": {
      "command": "node",
      "args": ["/Users/xxxx/figma-mcp/build/index.js"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_PERSONAL_FIGMA_ACCESS_TOKEN"
      }
    }
  }
}
```

#### Cursor

Update `mcp.json`:
```json
{
  "mcpServers": {
    "figma": {
      "command": "node",
      "args": ["/Users/liuzhe.x/coding/flowbite-mcp/build/index.js"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_PERSONAL_FIGMA_ACCESS_TOKEN"
      }
    }
  }
}
```

### 3. Usage

Simply provide a Figma design URL to the AI assistant:

```
Convert this Figma design: https://www.figma.com/design/FILE_KEY/MyFile?node-id=123-456
```

The AI will analyze the design and generate clean HTML markup with Tailwind CSS.

## Development

### Local setup

```bash
git clone https://github.com/yourusername/figma-mcp.git
cd figma-mcp
npm install
npm run build
npm start
```

### Run modes

**Default (stdio mode for Claude Desktop/Cursor):**
```bash
npm start
```

**HTTP server mode:**
```bash
npm start -- --mode http --port 3000
```

Then access at `http://localhost:3000/mcp`.

### MCP Inspector

Debug with the MCP Inspector:
```bash
npm run inspector
```

## Project structure

```
figma-mcp/
├── src/
│   ├── index.ts              # Main entry point
│   └── server-runner.ts      # HTTP transport
├── build/                    # Compiled output
└── package.json
```

## Contributing

Contributions welcome! Please submit a Pull Request.

## License

MIT - See [LICENSE](LICENSE) file for details.
