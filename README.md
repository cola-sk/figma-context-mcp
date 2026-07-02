# Figma Context MCP

一个 MCP server，用于把 Figma 节点提取成适合 AI Agent 使用的设计上下文。

当前运行时只做一件稳定的事：根据 Figma node URL 拉取节点 JSON 和渲染图，清理无效、默认、隐藏或噪声字段，然后返回简化 JSON。Agent 再结合目标项目自己的组件库、技能或代码规范生成页面。

组件映射数据、Figma 插件导出 JSON、组件截图都属于业务资产，统一放在本地目录 `figma-component-assets-private/`。该目录已被 gitignore，未来可以直接替换成 private submodule。

## 核心流程

```text
Figma node URL
  -> convert-figma-to-code
  -> 简化 JSON + 渲染图 URL
  -> Agent 根据项目组件库生成 UI
```

组件映射数据单独维护：

```text
tools/figma-component-registry-plugin 导出 registry ZIP
  -> figma-component-assets-private/{d,b}-components/all.json
  -> pnpm map:generate
  -> figma-component-assets-private/mappings/{d,b}-figma-component-key-map.json
  -> pnpm previews:export
  -> figma-component-assets-private/previews/{d,b}/
```

## MCP Server

当前 MCP 名称保持不变：`Figma Context MCP`。

当前工具：

| Tool | 作用 |
| --- | --- |
| `convert-figma-to-code` | 拉取 Figma 节点、渲染预览图，并返回简化后的节点 JSON。 |

当前运行时不启用 design token 解析，也不在 MCP 内做自动组件匹配。组件选择由下游 Agent 根据项目技能、组件目录或业务约定完成。

## MCP 配置

GitHub Copilot / VS Code：

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

Claude Desktop / Cursor：

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

本地构建版本：

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

当前不要在 MCP config 中配置 `TI_DESIGN_TOKEN_DIR`、`TI_TOKEN_SET` 或 `.figma-context-mcp.json`。这些属于未来 token 能力，不属于当前运行路径。

## 私有业务资产

业务敏感数据统一放在：

```text
figma-component-assets-private/
├── d-components/
├── b-components/
├── mappings/
└── previews/
```

说明：

- `d-components/`、`b-components/`：Figma 插件导出的组件 JSON。
- `mappings/`：生成后的组件映射 JSON。
- `previews/`：组件截图缓存。
- 该目录已加入 `.gitignore`，不会提交到当前仓库。
- 未来可以把该目录替换为 private submodule。

如果本地资产目录不在默认位置，可以通过环境变量覆盖：

```bash
export FIGMA_COMPONENT_ASSETS_DIR="/path/to/figma-component-assets-private"
```

## 完整组件映射流程

### 1. 安装 Figma 导出插件

插件代码在：

```text
tools/figma-component-registry-plugin/
```

在 Figma 中安装：

1. 打开 Figma。
2. 进入 `Plugins > Development > Import plugin from manifest...`。
3. 选择 `tools/figma-component-registry-plugin/manifest.json`。
4. 打开 Design System 文件后运行 `Component Registry Exporter`。

### 2. 导出 component JSON

在插件界面选择：

- 导出类型选 `组件注册表 registry`。
- 勾选要导出的组件 page。
- 如果顶部显示 `fileKey: unavailable`，在输入框粘贴当前 Figma 文件链接或 fileKey。
- 点击 `导出 ZIP`。

这里默认使用 `registry`，因为当前组件映射链路只需要组件身份、`componentSet.key`、`component.key`、variant 信息和索引。`design-spec` 会额外导出样式、变量绑定和内部节点树，适合未来做设计校验或 token 校验，不是当前默认输入。

ZIP 解压后会包含：

```text
index.json
all.json
pages/*.json
```

替换到对应目录：

```text
figma-component-assets-private/d-components/
figma-component-assets-private/b-components/
```

其中 `all.json` 必须包含 `source.fileKey`，后续截图导出会用它调用 Figma Images API。

### 3. 生成 component map

```bash
pnpm map:generate
```

脚本读取：

```text
figma-component-assets-private/d-components/all.json
figma-component-assets-private/b-components/all.json
```

输出：

```text
figma-component-assets-private/mappings/d-figma-component-key-map.json
figma-component-assets-private/mappings/b-figma-component-key-map.json
```

生成时会从已有 map 继承人工确认过的映射，匹配优先级是：

```text
figma.key -> figma.id -> page + name
```

### 4. 导出 preview image

设置 Figma token：

```bash
export FIGMA_ACCESS_TOKEN="YOUR_FIGMA_TOKEN"
```

导出 D 端全部组件截图：

```bash
pnpm previews:export -- --system d --all --delay-ms 500
```

导出 B 端全部组件截图：

```bash
pnpm previews:export -- --system b --all --delay-ms 500
```

截图输出到：

```text
figma-component-assets-private/previews/{system}/
figma-component-assets-private/previews/{system}/index.json
```

Dashboard 页面里的 `/previews/{system}/{fileName}` 不是 public 静态目录，而是由 Next route 从 `figma-component-assets-private/previews/` 读取后返回。这样截图不会进入 Git，也不会放在 `app/public/`。

### 5. 在 Dashboard 校验和编辑

```bash
pnpm map-viewer:dev
```

打开：

```text
http://localhost:3217/?system=d
http://localhost:3217/?system=b
```

Dashboard 会读取私有目录中的 map 和 preview index。编辑映射后，会直接写回 `figma-component-assets-private/mappings/` 下对应的 JSON。

## 生成映射

```bash
pnpm map:generate
```

`pnpm map:generate` 会先读取已有的 d/b map，再回退到 `figma-component-assets-private/mappings/figma-component-key-map.json` 作为种子数据。它会按 `figma.key`、`figma.id`、`page + name` 依次匹配，尽量保留已经人工确认过的映射结果。

## 导出截图

```bash
export FIGMA_ACCESS_TOKEN="YOUR_FIGMA_TOKEN"
pnpm previews:export -- --system d --all --delay-ms 500
```

常用方式：

```bash
pnpm previews:export -- --system d --name Button
pnpm previews:export -- --system d --key <componentKey>
pnpm previews:export -- --system d --name Button --variants false
```

截图会写入：

```text
figma-component-assets-private/previews/{system}/
```

## Dashboard

Dashboard 是组件映射的辅助查看和编辑工具，具体说明见 [app/README.md](app/README.md)。

```bash
pnpm map-viewer:dev
pnpm map-viewer:build
```

## 开发

```bash
npm run build
npm start
npm run dev
npm run inspector
```

HTTP mode：

```bash
npm run start:http
```

## Future Token Capability

Design token 解析能力已经从当前运行路径移除，并归档在：

```text
docs/future-token-capability/
```

未来如果重新启用 token 能力，应先从这个目录恢复上下文和代码，而不是直接把 token 逻辑混回当前简化 JSON 路径。

## 项目结构

```text
figma-context-mcp/
├── src/                              # MCP server runtime
├── data/                             # MCP resource docs
├── scripts/                          # mapping / preview scripts
├── app/                              # Component Map Viewer Dashboard
├── docs/future-token-capability/
├── figma-component-assets-private/   # gitignored business assets
├── build/
└── package.json
```

## License

MIT
