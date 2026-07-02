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

当前运行时不在 MCP 内做自动组件匹配。组件选择由下游 Agent 根据项目技能、组件目录或业务约定完成。

### `convert-figma-to-code` 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `figmaNodeUrl` | `string` | 是 | 无 | Figma 节点 URL，支持 `https://www.figma.com/file/{fileKey}/...?node-id=...` 和 `https://www.figma.com/design/{fileKey}/...?node-id=...`。 |
| `includeVariables` | `boolean` | 否 | 读取 `FIGMA_INCLUDE_VARIABLES`，未配置时为 `false` | 是否在简化 JSON 中保留精简后的原始 `boundVariables`，主要用于调试变量绑定。 |
| `includeVectorPaths` | `boolean` | 否 | 读取 `FIGMA_INCLUDE_VECTOR_PATHS`，未配置时为 `false` | 是否请求并返回原始 vector path。开启后会向 Figma Nodes API 增加 `geometry=paths`，输出体积会明显变大。 |

调用示例：

```json
{
  "figmaNodeUrl": "https://www.figma.com/design/{fileKey}/My-Design?node-id=123-456",
  "includeVariables": false,
  "includeVectorPaths": false
}
```

### MCP 启动参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--mode <stdio\|http>` | `stdio` | MCP transport 模式。也可以用 `MCP_TRANSPORT_MODE` 配置。 |
| `--port <number>` | `3000` | HTTP 模式监听端口。也可以用 `MCP_PORT` 配置。 |
| `--version` / `-v` | 无 | 输出当前包版本。 |
| `--help` / `-h` | 无 | 输出命令帮助。 |

示例：

```bash
figma-context-mcp --mode stdio
figma-context-mcp --mode http --port 3000
```

### 环境变量

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FIGMA_ACCESS_TOKEN` | 无 | Figma Personal Access Token。调用 `convert-figma-to-code` 和导出 preview image 时必填。 |
| `FIGMA_INCLUDE_VARIABLES` | `false` | 当值为 `1` 或 `true` 时，`convert-figma-to-code` 默认包含精简后的 `boundVariables`。可被 tool 入参 `includeVariables` 覆盖。 |
| `FIGMA_INCLUDE_VECTOR_PATHS` | `false` | 当值为 `1` 或 `true` 时，`convert-figma-to-code` 默认包含 vector path。可被 tool 入参 `includeVectorPaths` 覆盖。 |
| `MCP_TRANSPORT_MODE` | `stdio` | MCP transport 模式。可被命令行 `--mode` 覆盖。 |
| `MCP_PORT` | `3000` | HTTP 模式端口。可被命令行 `--port` 覆盖。 |
| `FIGMA_COMPONENT_ASSETS_DIR` | `figma-component-assets-private` | 私有业务资产目录。影响 map 生成、preview 导出和 Dashboard 读取。 |

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

## 私有业务资产

业务敏感数据统一放在：

```text
figma-component-assets-private/
├── d-components/
├── b-components/
├── mappings/
├── previews/
└── tokens/
```

说明：

- `d-components/`、`b-components/`：Figma 插件导出的组件 JSON。
- `mappings/`：生成后的组件映射 JSON。
- `previews/`：组件截图缓存。
- `tokens/`：`figma-variable-key-exporter` 导出的 variable collection JSON，MCP 暂不消费。
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

这里默认使用 `registry`，因为当前组件映射链路只需要组件身份、`componentSet.key`、`component.key`、variant 信息和索引。`design-spec` 会额外导出样式、变量绑定和内部节点树，不是当前默认输入。

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

支持参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--system <d\|b>` | `d` | 选择 D 端或 B 端 map。除 `b` 以外的值都会按 `d` 处理。 |
| `--all` | `false` | 导出当前 system 下所有 component set 和 loose component。 |
| `--name <name>` | 空 | 按组件名称精确匹配，比较时会转为小写。 |
| `--key <componentKey>` | 空 | 按 component set key 或 loose component key 精确匹配。 |
| `--variants <true\|false>` | `true` | 导出 component set 时是否同时导出下面的 variants。传 `false` 只导出 component set 本身。 |
| `--scale <number>` | `2` | Figma Images API 的图片倍率。 |
| `--batchSize <number>` | `20` | 每次请求 Figma Images API 的节点数量。批量失败时会自动降级为单个节点重试。 |
| `--delay-ms <number>` | `0` | 每个组件组之间的等待时间，串行导出大量组件时可用于降低触发限流的概率。 |

`--all`、`--name`、`--key` 至少需要传一个，否则脚本会拒绝执行，避免误触发大批量请求。

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

## 项目结构

```text
figma-context-mcp/
├── src/                              # MCP server runtime
├── data/                             # MCP resource docs
├── scripts/                          # mapping / preview scripts
├── app/                              # Component Map Viewer Dashboard
├── figma-component-assets-private/   # gitignored business assets
├── build/
└── package.json
```

## License

MIT
