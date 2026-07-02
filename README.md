# Figma Context MCP

一个 MCP server，用于把 Figma 节点提取成适合 AI Agent 使用的设计上下文。

当前运行时根据 Figma node URL 拉取节点 JSON 和渲染图，清理无效、默认、隐藏或噪声字段，然后返回简化 JSON。业务项目配置组件映射后，MCP 会在 Figma INSTANCE 节点上注入 `tiComponent` 组件身份 hint，Agent 再结合目标项目自己的组件库、技能或代码规范生成页面。

组件映射数据、Figma 插件导出 JSON、组件截图都属于业务资产，统一放在本地目录 `figma-component-assets-private/`。该目录已被 gitignore，未来可以直接替换成 private submodule。

## 核心流程

```text
Figma node URL
  -> convert-figma-to-code
  -> 简化 JSON + tiComponent hint + 渲染图 URL
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

## 节点 JSON 简化与优化

Figma 原始 API 返回的节点数据包含大量冗余或默认字段。MCP Server 通过多个阶段对节点 JSON（使用 **Compact 紧凑格式**，即去除换行和缩进）进行简化与压缩。

以下对比了两个典型案例在各优化阶段的实际表现：
* **案例 1 (小节点 `3078-3670`)**：包含隐藏 Tab 的 Tabs 组件。
* **案例 2 (大节点 `3078-4492`)**：规模较大的页面或区块节点，内部包含大量隐藏图层。

### 优化阶段与大小对比 (Compact JSON)

| 优化阶段 | 具体优化处理内容 | 案例 1 (小节点 `3078-3670`) | 案例 2 (大节点 `3078-4492`) |
| :--- | :--- | :--- | :--- |
| **0. Figma 原始数据** | Figma API 直接返回的原始节点树数据。 | **26,989 bytes** (27.0 KB)<br>节点数: - | **1,021,220 bytes** (~1.02 MB)<br>节点数: 841 |
| **1. 基础噪声清理** | 移除无效、默认样式（如 `visible: true`, `blendMode: "NORMAL"`）及其他多余噪声字段。 | **16,244 bytes** (16.2 KB)<br>节点数: 17 个<br>累计降幅: **-39.81%** | **415,735 bytes** (~415.7 KB)<br>节点数: 841 个<br>累计降幅: **-59.29%** |
| **2. `visible: false` 过滤** | 在基础清理之上，直接丢弃所有 `visible: false` 节点及其整棵子树（彻底排除隐藏组件干扰）。 | **5,599 bytes** (5.6 KB)<br>节点数: 5 个<br>阶段降幅: **-65.53%**<br>累计降幅: **-79.25%** | **120,171 bytes** (~120.2 KB)<br>节点数: 262 个<br>阶段降幅: **-71.09%**<br>累计降幅: **-88.23%** |

> [!TIP]
> * **为什么使用 Compact 格式？** Compact 格式去除了所有空格与换行，极大地压缩了体积，最适合作为 AI Agent 交互和传输的 Payload，可有效节省 Token。与之相对的 **Pretty 格式**（带缩进换行，上述优化后案例 1 为 9.8 KB，案例 2 约为 250 KB）更易于人工阅读与调试。
> * **优化收益**：对于大型节点（案例 2），累积降幅达 **-88.23%** (从 1.02 MB 缩减至 120 KB)，节点数从 841 缩减至 262。这不仅大幅节省了 Token 占用，也排除了隐藏图层对 Agent 生成代码时的干扰。

## MCP Server

当前 MCP 名称保持不变：`Figma Context MCP`。

当前工具：

| Tool | 作用 |
| --- | --- |
| `convert-figma-to-code` | 拉取 Figma 节点、渲染预览图，并返回简化后的节点 JSON；配置组件映射后注入 `tiComponent` hint。 |

当前运行时不启用 design token 解析。组件映射只做身份识别，不推断 variant 到 props 的映射；具体 API 仍由下游 Agent 通过项目技能或组件目录查询。

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

当前不要在 MCP config 中配置 `TI_DESIGN_TOKEN_DIR` 或 `TI_TOKEN_SET`。组件映射通过业务项目根目录的 `.figma-context-mcp.json` 配置。

## 业务项目组件映射配置

在业务项目根目录创建：

```json
{
  "componentMap": {
    "source": "d",
    "inject": true
  }
}
```

字段说明：

- `source: "b"`：使用【内部公开版】Titan Design System 映射。
- `source: "d"`：使用主题开发者平台 Design System 映射。
- `source: "auto"`：仅当请求的 Figma fileKey 正好是 b/d 库文件时自动识别；普通业务文件建议显式配置 b 或 d。
- `source: "none"` 或 `inject: false`：关闭 `tiComponent` 注入。
- `overridePath`：可选，自定义 map 文件路径；相对路径按业务项目根目录解析。

启用后，INSTANCE 节点会出现：

```json
{
  "tiComponent": {
    "status": "mapped",
    "library": "Element Plus",
    "component": "el-button",
    "variantProps": null
  }
}
```

### 变种（Variant）属性与 Props 映射设计

本 MCP Server 采用 **Identity-Only（仅身份识别）** 设计。这意味着：
* **MCP 职责**：仅负责定位组件的身份（例如将 Figma 节点映射到 `el-button`），并在节点上注入身份 Hint，而具体的 `variantProps` 默认为 `null`。
* **Agent 职责**：下游 AI Agent 在接收到简化后的节点 JSON 后，结合原始属性，负责**手动**将 Figma 的变种属性（如 `size = "small"`）转换为组件库对应的 Props（如 `:size="small"`）。
* **为什么不需要在映射 Scheme 中声明 Props？**
  组件库（如 Element Plus）的 API 庞大且多变，在静态映射表里强行定义所有 Variant-to-Props 的规则，会导致映射表极其臃肿且难以维护。AI Agent 可以通过上下文、项目组件规范或专用技能动态映射，因此 MCP 仅需确保组件身份识别正确。

#### 什么时候需要在 Mapping 中声明 Props？
在未来的功能扩展或特殊场景中，以下情况可能需要我们在 Mapping 结构中显式声明/注入 `variantProps`：
1. **Agent 缺乏相关背景知识**：下游使用的 LLM 基础能力较弱，或没有挂载相关的组件库 API 技能，导致其无法自主、准确地将 Figma 变种推断为代码 Props。
2. **非常规/非标准的复杂属性转换**：某些 Figma 属性或特殊取值，无法直接一对一转换为 Props，而是需要经过复杂的逻辑计算、条件过滤或转换为特定的 CSS 类名。
3. **强确定性的低代码编译（Rule-based Codegen）**：在不依赖 LLM 推理的自动化低代码/无代码编译器中，所有的节点及属性翻译必须是 100% 确定且基于静态规则的，此时必须在 Scheme 中写死所有的映射规则。

`status: "unmapped"` 或 `"internal"` 时，Agent 应向用户说明该节点未映射，不应根据视觉 JSON 手写一个仿制组件。可读取 `figma://component-map/summary` 查看当前配置摘要。

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
