# Figma Context MCP

一个 [MCP 服务器](https://modelcontextprotocol.io/)，用于将 Figma 设计转换为结构化代码上下文，支持 AI 代理生成生产级前端代码。

通过提供 Figma 节点 URL，服务器会提取设计数据并生成代码所需的完整上下文信息。

## 功能

- **设计结构提取** - 从 Figma 节点提取布局、尺寸、文本、颜色等设计结构
- **视觉预览渲染** - 生成设计的图片预览，帮助 AI 代理准确理解设计意图
- **Token-aware 样式生成** - 读取 `ti-d-variables-token.json`，把 Figma `boundVariables` 解析成可用于代码生成的 Semantic / Component token
- **样式策略控制** - 支持 `preferTokens`（token 优先）和 `tokensOnly`（token 强制）两种策略
- **代理集成** - 与 AI 代理的技能库（如 `component-skills`）无缝配合
- **多种传输模式** - 支持 stdio（Claude Desktop、Cursor）和 HTTP 服务器模式

## 工作流程

```
Figma 设计 → MCP 工具提取 → 结构化数据 + 预览图 + tokenBindings → AI 代理
                                                                    ↓
                                      Semantic / Component token + CSS variable → 生成代码
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

### 2. 配置 MCP 环境变量

获取 [Figma 个人访问令牌](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens)，然后配置你的 MCP 客户端。

最小可用配置只需要 Figma token：

```json
{
  "env": {
    "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN"
  }
}
```

如果要让 MCP 把 Figma `boundVariables` 解析成项目里的 CSS variables，推荐同时配置 token 仓库：

```json
{
  "env": {
    "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN",
    "TI_DESIGN_TOKEN_DIR": "/Users/YOUR_NAME/coding/ti-d-design-token",
    "TI_TOKEN_SET": "d"
  }
}
```

`TI_DESIGN_TOKEN_DIR` 建议始终使用绝对路径，因为不同 editor / agent 启动 MCP server 时的当前工作目录不一定相同。MCP 会根据 `TI_TOKEN_SET` 自动读取 token 仓库 `manifest.json`，推导出 token 变量文件、CSS variable metadata 和远程变量 alias 映射文件。

### 2.1 配置业务项目上下文

如果同一套 MCP server 会在 B 端、D 端等多个业务项目之间切换，不需要反复修改 MCP 客户端配置。推荐在业务项目根目录放 `.figma-context-mcp.json`：

```json
{
  "tokenSetId": "b"
}
```

D 端项目则写：

```json
{
  "tokenSetId": "d"
}
```

工具调用时，MCP 会通过客户端暴露的 workspace roots 查找当前业务项目里的 `.figma-context-mcp.json`，并从该文件读取默认上下文。客户端不支持 roots 时，会回退到 MCP server 的启动目录，再回退环境变量。

`.figma-context-mcp.json` 支持以下字段：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `tokenSetId` | string | token set id，例如 `b` 或 `d`。 |
| `designTokenDir` | string | 覆盖 token 仓库路径。 |
| `styleStrategy` | `"preferTokens"` / `"tokensOnly"` | 覆盖默认样式策略。 |
| `tokenDetail` | `"compact"` / `"full"` | 覆盖 token 元数据输出详细程度。 |
| `includeVariables` | boolean | 是否输出 compact raw `boundVariables`。 |
| `includeVectorPaths` | boolean | 是否请求并输出 raw vector path 数据。 |
| `variablesTokenFile` | string | 高级覆盖项，直接指定变量 token 文件。 |
| `cssVariablesFile` | string | 高级覆盖项，直接指定 CSS variable metadata 文件。 |
| `variableAliasFile` | string | 高级覆盖项，直接指定 remote variable alias 映射文件。 |

#### 环境变量说明

| 环境变量 | 必填 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `FIGMA_ACCESS_TOKEN` | 是 | 无 | Figma Personal Access Token。用于调用 Figma node API 和 image API。 |
| `TI_DESIGN_TOKEN_DIR` | 否 | 无 | `ti-d-design-token` 仓库的绝对路径。配置后 MCP 会从该仓库读取 token 文件，并把 Figma 变量绑定解析成 `tokenBindings` / `tokenGaps`。不配置时仍会返回设计结构，但不会生成 token-backed CSS variable 上下文。 |
| `TI_TOKEN_SET` | 否 | `d` | token set id，例如 `d` 或 `b`。仅在工具调用参数和 `.figma-context-mcp.json` 都没有配置 `tokenSetId` 时生效。 |
| `TOKEN_SET_ID` | 否 | `d` | `TI_TOKEN_SET` 的兼容别名。优先级低于工具参数 `tokenSetId`、项目配置和 `TI_TOKEN_SET`。 |
| `FIGMA_STYLE_STRATEGY` | 否 | `preferTokens` | 工具调用没有传 `styleStrategy` 时的默认样式策略。有效值只有 `preferTokens` 和 `tokensOnly`；其他值会被当成 `preferTokens`。 |
| `FIGMA_TOKEN_DETAIL` | 否 | `compact` | token 元数据输出详细程度。`compact` 只保留代码生成需要的 `sourcePath`、`property`、`cssVariable`、`codeValue`；`full` 会额外输出 token reference、resolved value、chain 等调试信息。只有配置了 token registry 时生效。 |
| `FIGMA_INCLUDE_VARIABLES` | 否 | `false` | 是否在简化 JSON 中输出 Figma 原始 `boundVariables` / `explicitVariableModes`。只有字符串 `1` 或 `true` 会开启。日常生成代码建议关闭，排查 Figma 是否返回变量绑定时再打开。 |
| `FIGMA_INCLUDE_VECTOR_PATHS` | 否 | `false` | 是否请求并输出 raw vector path 数据。只有字符串 `1` 或 `true` 会开启。开启后 Figma node API 会追加 `geometry=paths`，响应体可能明显变大。 |
| `FIGMA_VARIABLES_TOKEN_FILE` | 否 | 由 `TI_DESIGN_TOKEN_DIR` + `TI_TOKEN_SET` 推导 | 高级覆盖项，直接指定 `ti-*-variables-token.json` 绝对路径。优先级高于从 token 仓库推导的路径。 |
| `FIGMA_CSS_VARIABLES_FILE` | 否 | 由 `TI_DESIGN_TOKEN_DIR` + `TI_TOKEN_SET` 推导 | 高级覆盖项，直接指定 CSS variable metadata 文件，例如 `ti-d-css-variables.json`。用于把 token 映射成 `var(--...)`。 |
| `FIGMA_VARIABLE_ALIAS_FILE` | 否 | 由 `TI_DESIGN_TOKEN_DIR` + `TI_TOKEN_SET` 推导 | 高级覆盖项，直接指定 `remote-variable-aliases.json`。用于把 Figma remote variable id 映射到本地 token variable id。 |

#### 工具参数说明

这些参数是在 agent 调用 `convert-figma-to-code` 工具时传入的。工具参数优先级高于项目配置和环境变量。

| 工具参数 | 必填 | 默认值 | 对应 env | 作用 |
| --- | --- | --- | --- | --- |
| `figmaNodeUrl` | 是 | 无 | 无 | Figma 节点 URL，必须包含 `node-id`。 |
| `styleStrategy` | 否 | `.figma-context-mcp.json`，再回退到 `FIGMA_STYLE_STRATEGY`，最后回退到 `preferTokens` | `FIGMA_STYLE_STRATEGY` | 控制生成提示对 token 的要求。`preferTokens` 表示有 token 就用 token，没 token 才允许 `literalFallback`；`tokensOnly` 表示样式必须来自 token，缺失时输出 `tokenGaps` 并要求 agent 先报告缺口。 |
| `tokenDetail` | 否 | `.figma-context-mcp.json`，再回退到 `FIGMA_TOKEN_DETAIL`，最后回退到 `compact` | `FIGMA_TOKEN_DETAIL` | 控制 token 元数据体积。日常代码生成使用默认 `compact`；排查 token 映射链路时使用 `full`。 |
| `designTokenDir` | 否 | `.figma-context-mcp.json`，再回退到 `TI_DESIGN_TOKEN_DIR` | `TI_DESIGN_TOKEN_DIR` | 覆盖 token 仓库路径。 |
| `tokenSetId` | 否 | `.figma-context-mcp.json`，再回退到 `TI_TOKEN_SET` / `TOKEN_SET_ID`，最后回退到 `d` | `TI_TOKEN_SET` / `TOKEN_SET_ID` | 覆盖 token set id。 |
| `includeVariables` | 否 | `.figma-context-mcp.json`，再回退到 `FIGMA_INCLUDE_VARIABLES`，最后回退到 `false` | `FIGMA_INCLUDE_VARIABLES` | 是否输出 compact raw `boundVariables`。不影响 MCP 内部 token 解析；只控制最终 JSON 是否带原始变量字段。 |
| `includeVectorPaths` | 否 | `.figma-context-mcp.json`，再回退到 `FIGMA_INCLUDE_VECTOR_PATHS`，最后回退到 `false` | `FIGMA_INCLUDE_VECTOR_PATHS` | 是否请求并输出 raw vector path 数据。 |
| `variablesTokenFile` | 否 | `.figma-context-mcp.json`，再回退到 `FIGMA_VARIABLES_TOKEN_FILE`，最后回退到自动推导路径 | `FIGMA_VARIABLES_TOKEN_FILE` | 覆盖变量 token 文件路径。 |
| `cssVariablesFile` | 否 | `.figma-context-mcp.json`，再回退到 `FIGMA_CSS_VARIABLES_FILE`，最后回退到自动推导路径 | `FIGMA_CSS_VARIABLES_FILE` | 覆盖 CSS variable metadata 文件路径。 |
| `variableAliasFile` | 否 | `.figma-context-mcp.json`，再回退到 `FIGMA_VARIABLE_ALIAS_FILE`，最后回退到自动推导路径 | `FIGMA_VARIABLE_ALIAS_FILE` | 覆盖 remote variable alias 映射文件路径。 |

#### 优先级规则

同一个配置项存在多种来源时，按下面顺序决定最终值：

```text
工具调用参数 > 项目级 .figma-context-mcp.json > 环境变量 > 默认值
```

token 文件路径的推导规则是：

```text
显式文件参数 / 文件 env
  > TI_DESIGN_TOKEN_DIR + manifest.json 中的 token set 配置
  > TI_DESIGN_TOKEN_DIR/packages/{tokenSetId}/dist 或 mappings 的约定路径
```

#### 常见配置场景

日常页面生成，推荐使用 token 但允许缺失项回退：

```json
{
  "env": {
    "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN",
    "TI_DESIGN_TOKEN_DIR": "/Users/YOUR_NAME/coding/ti-d-design-token",
    "TI_TOKEN_SET": "d",
    "FIGMA_STYLE_STRATEGY": "preferTokens",
    "FIGMA_INCLUDE_VARIABLES": "false",
    "FIGMA_INCLUDE_VECTOR_PATHS": "false"
  }
}
```

检查设计稿 token 覆盖率，缺 token 时不希望 agent 写硬编码值：

```json
{
  "env": {
    "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN",
    "TI_DESIGN_TOKEN_DIR": "/Users/YOUR_NAME/coding/ti-d-design-token",
    "TI_TOKEN_SET": "d",
    "FIGMA_STYLE_STRATEGY": "tokensOnly"
  }
}
```

排查 Figma 是否真的返回变量绑定：

```json
{
  "env": {
    "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN",
    "TI_DESIGN_TOKEN_DIR": "/Users/YOUR_NAME/coding/ti-d-design-token",
    "TI_TOKEN_SET": "d",
    "FIGMA_INCLUDE_VARIABLES": "true"
  }
}
```

只读取设计结构，不做 token 解析：

```json
{
  "env": {
    "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN",
    "FIGMA_INCLUDE_VARIABLES": "false",
    "FIGMA_INCLUDE_VECTOR_PATHS": "false"
  }
}
```

这种配置不要设置 `TI_DESIGN_TOKEN_DIR`、`FIGMA_VARIABLES_TOKEN_FILE`、`FIGMA_CSS_VARIABLES_FILE` 或 `FIGMA_VARIABLE_ALIAS_FILE`。

不配置 token registry 时，MCP 会把 token resolution 视为 disabled，不输出 `tokenBindings` / `tokenGaps`，避免把“当前没有 token 文件可解析”当成设计稿 token 覆盖缺口传给 LLM。

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
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN",
        "TI_DESIGN_TOKEN_DIR": "/Users/YOUR_NAME/coding/ti-d-design-token",
        "TI_TOKEN_SET": "d"
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
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN",
        "TI_DESIGN_TOKEN_DIR": "/Users/YOUR_NAME/coding/ti-d-design-token",
        "TI_TOKEN_SET": "d"
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
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN",
        "TI_DESIGN_TOKEN_DIR": "/Users/YOUR_NAME/coding/ti-d-design-token",
        "TI_TOKEN_SET": "d"
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
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN",
        "TI_DESIGN_TOKEN_DIR": "/Users/YOUR_NAME/coding/ti-d-design-token",
        "TI_TOKEN_SET": "d"
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
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN",
        "TI_DESIGN_TOKEN_DIR": "/Users/YOUR_NAME/coding/ti-d-design-token",
        "TI_TOKEN_SET": "d"
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
        "FIGMA_ACCESS_TOKEN": "YOUR_TOKEN",
        "TI_DESIGN_TOKEN_DIR": "/Users/YOUR_NAME/coding/ti-d-design-token",
        "TI_TOKEN_SET": "d"
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

工具支持两个样式策略：

```json
{
  "figmaNodeUrl": "https://www.figma.com/design/FILE_KEY/MyFile?node-id=123-456",
  "styleStrategy": "preferTokens",
  "tokenDetail": "compact"
}
```

`preferTokens` 是默认策略：Figma 节点上有 Semantic 或 Component variable 绑定时，输出 `tokenBindings` 并要求代码使用变量；没有绑定时允许使用 `literalFallback`。`tokenDetail` 默认是 `compact`，会保留 CSS variable 代码生成所需的 `codeValue`，但省略调试字段。

```json
{
  "figmaNodeUrl": "https://www.figma.com/design/FILE_KEY/MyFile?node-id=123-456",
  "styleStrategy": "tokensOnly"
}
```

`tokensOnly` 是强制策略：颜色、圆角、间距、描边、阴影、字体等样式值必须来自 Semantic 或 Component token。缺失绑定时，输出 `tokenGaps`，下游 agent 应先报告缺失 token，不生成最终页面代码，也不能写硬编码值。

返回内容中的 `Token Usage Summary` 会同时区分“是否可以生成代码”和“是否可以生成纯 token 代码”：

```text
- Can generate code: yes
- Can generate token-pure code: no
```

`preferTokens` 下即使存在 `tokenGaps`，也可能允许生成代码，因为缺失项可按策略使用 `literalFallback`；但只要存在 `tokenGaps`，就不能视为 token-pure。`tokensOnly` 下存在任何 `tokenGaps` 时，`Can generate code` 会是 `no`，agent 应先报告缺口。

如果需要排查某个 Figma variable 到 CSS variable 的完整链路，可以临时使用：

```json
{
  "figmaNodeUrl": "https://www.figma.com/design/FILE_KEY/MyFile?node-id=123-456",
  "tokenDetail": "full"
}
```

## 简化 JSON 字段裁剪说明

工具返回的不是 Figma 原始 API JSON，而是经过简化处理的节点数据。以下说明哪些字段会在什么情况下被删除或转换，以及原因。

### 始终删除：空值与默认值

| 字段 / 条件 | 删除时机 | 原因 |
| --- | --- | --- |
| 任何值为 `null`、`undefined`、`[]`、`{}` 的字段 | 始终 | 消除深层嵌套对象中的噪声 |
| `opacity` | 值为 `1`（Figma 默认）时 | 默认值，无需生成 CSS |
| `blendMode` | 值为 `PASS_THROUGH` 或 `NORMAL` 时 | 均为默认混合模式 |
| `constraints` | `vertical = TOP` 且 `horizontal = LEFT` 时 | Figma 默认约束，不影响布局 |
| `isMask` | 值为 `false` 时 | 默认状态 |
| `rotation` | 绝对值 ≤ 0.001° 时 | 浮点舍入误差，实际为零 |
| `layoutPositioning`（输出为 `positioning`） | 值为 `AUTO` 时 | 自动布局默认定位方式；非 `AUTO` 时才记录为 `positioning` |
| `cornerSmoothing` | 值为 `0` 时 | 默认值 |
| `clipsContent` | 值为 `false` 时 | 默认状态 |

### 画板数组（fills / strokes / effects）

| 条件 | 处理方式 | 原因 |
| --- | --- | --- |
| `fill.visible === false` | 该 fill 条目从数组中移除 | 隐藏的 paint 不影响渲染结果 |
| `stroke.visible === false` | 该 stroke 条目从数组中移除 | 同上 |
| `effect.visible === false` | 该 effect 条目从数组中移除 | 同上 |

### 颜色值归一化

| 转换 | 原因 |
| --- | --- |
| `r / g / b` 浮点数（0.0 – 1.0）→ 整数（0 – 255） | Figma API 以分数编码颜色；整数更符合代码生成惯例 |
| `a` 保留 2 位小数 | 保持透明度可读，同时不损失精度 |

### 变量 / token 相关字段

| 字段 | 默认行为 | 如何覆盖 | 原因 |
| --- | --- | --- | --- |
| `boundVariables` | **完全删除** | 设置 `includeVariables: true` | 原始变量数据体积大；`tokenBindings` 已包含解析后的值 |
| `explicitVariableModes` | **完全删除** | 设置 `includeVariables: true` | 同上 |
| `boundVariables` 中的每条 alias（`includeVariables: true` 时） | 精简为 `{ type, id }` — 其余字段删除 | — | alias 的名称、描述等元数据不用于代码生成；`tokenBindings` 已承载可读信息 |

### Token bindings / gaps（仅配置了 token 源时生效）

| 字段 | `compact`（默认） | `full` | compact 模式下字段被删除的原因 |
| --- | --- | --- | --- |
| `tokenBindings[]` | `sourcePath`、`property`、`cssVariable`、`codeValue` | 额外包含 `reference`、`resolvedValue`、`resolvedType`、`chain` | 调试元数据，代码生成不需要 |
| `tokenGaps[]` | `sourcePath`、`property`、`reason` | 额外包含 `variableName`、`collection` | 同上 |

非 `Semantic` / 非 `Component` 集合的变量绑定（如 `Primitive` 集合）**永远不会**被提升为 `tokenBindings`，始终以 `tokenGaps` 形式输出，`reason` 为 `"not a Semantic or Component variable"`。这确保了业务代码只引用 Semantic 或 Component token。

### `position` 字段

当父节点有自动布局（`layoutMode = HORIZONTAL | VERTICAL`）**且**当前节点使用自动定位（`layoutPositioning = AUTO`）时，`position`（相对父节点的 x/y 偏移）会被**省略**。仅在父节点无自动布局、或节点明确使用绝对定位时才输出。原因：自动布局中坐标由布局引擎控制，在 CSS 中硬编码会与布局冲突。

### fills / strokes 中的 `literalFallback`

`literalFallback`（原始 hex / rgba 颜色字符串）**仅在** `styleStrategy = preferTokens` 时输出，`tokensOnly` 模式下**完全省略**。原因：防止 agent 在要求纯 token 输出时默默使用字面量颜色值。

### 向量路径

`vectorPaths` 默认**删除**，除非设置 `includeVectorPaths: true`（或环境变量 `FIGMA_INCLUDE_VECTOR_PATHS=true`）。原因：路径数据体积大，组件库代码生成几乎不需要。

### 顶层 components / styles 映射表

节点响应中的 `components`、`componentSets`、`styles` 映射表会被精简为只保留 `{ key, name, description, componentSetId, styleType }`，其余所有元数据（文档链接、remote 标记等）均删除。原因：组件映射只需要名称和 key。

---

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
│   ├── token-utils.ts        # Figma variable 解析、token 策略和 CSS variable 映射
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
