# Figma Context MCP

一个 [MCP 服务器](https://modelcontextprotocol.io/)，用于将 Figma 设计转换为结构化代码上下文，支持 AI 代理生成生产级前端代码。

通过提供 Figma 节点 URL，服务器会提取设计数据并生成代码所需的完整上下文信息。

## 功能

- **设计结构提取** - 从 Figma 节点提取布局、尺寸、文本、颜色等设计结构
- **视觉预览渲染** - 生成设计的图片预览，帮助 AI 代理准确理解设计意图
- **代理集成** - 与 AI 代理的技能库（如 `component-skills`）无缝配合
- **多种传输模式** - 支持 stdio（Claude Desktop、Cursor）和 HTTP 服务器模式

## 工作流程

```
Figma 设计 → MCP 工具提取 → 结构化数据 + 预览图 → AI 代理
                                                     ↓
                                          映射到组件库 → 生成代码
```

## 快速开始

### 1. 安装

**全局安装（推荐）：**
```bash
npm install -g @sking7/figma-context-mcp
```

**或从源代码构建：**
```bash
git clone https://github.com/cola-sk/figma-context-mcp
cd figma-context-mcp
npm install
npm run build
```

### 2. 配置 Figma 访问令牌

获取 [Figma 个人访问令牌](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens)，然后配置你的 MCP 客户端。

#### GitHub Copilot (VS Code)

编辑项目根目录的 `.vscode/mcp.json`：

**全局安装版本：**
```json
{
  "servers": {
    "figma-context-mcp": {
      "type": "stdio",
      "command": "figma-context-mcp",
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

**本地开发版本（使用 git 代码构建）：**
```json
{
  "servers": {
    "figma-context-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/figma-mcp/build/index.js"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

> 将 `/path/to/figma-mcp` 替换为你克隆的项目路径，确保已执行 `npm run build`

#### Claude Desktop

编辑 `claude_desktop_config.json`：

**全局安装版本：**
```json
{
  "mcpServers": {
    "figma-context-mcp": {
      "type": "stdio",
      "command": "figma-context-mcp",
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

**本地开发版本（使用 git 代码构建）：**
```json
{
  "mcpServers": {
    "figma-context-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/figma-mcp/build/index.js"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

> 将 `/path/to/figma-mcp` 替换为你克隆的项目路径

#### Cursor

编辑 `mcp.json`：

**全局安装版本：**
```json
{
  "mcpServers": {
    "figma-context-mcp": {
      "type": "stdio",
      "command": "figma-context-mcp",
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

**本地开发版本（使用 git 代码构建）：**
```json
{
  "mcpServers": {
    "figma-context-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/figma-mcp/build/index.js"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

> 将 `/path/to/figma-mcp` 替换为你克隆的项目路径

### 3. 使用

向 AI 助手提供 Figma 节点 URL：

```
提取这个 Figma 设计的代码上下文：https://www.figma.com/design/FILE_KEY/MyFile?node-id=123-456
```

助手将获取设计数据并根据其技能库生成对应的代码。

## 开发

### 本地设置

```bash
git clone https://github.com/cola-sk/figma-context-mcp
cd figma-context-mcp
npm install
npm run build
npm start
```

### 运行模式

**stdio 模式（Claude Desktop / Cursor）：**
```bash
npm start
```

**HTTP 服务器模式：**
```bash
npm start -- --mode http --port 3000
```

服务器地址：`http://localhost:3000/mcp`

### MCP Inspector

```bash
npm run inspector
```

### 开发监控

```bash
npm run dev
```

## 项目结构

```
figma-context-mcp/
├── src/
│   ├── index.ts              # MCP 服务器入口和工具定义
│   └── server-runner.ts      # HTTP 传输层（Express）
├── data/
│   ├── overview.md           # 服务器概览资源
│   └── quickstart.md         # 快速开始指南
├── build/                    # 编译输出
├── mcp-config.json           # MCP 服务器配置
└── package.json
```

## 许可证

MIT
