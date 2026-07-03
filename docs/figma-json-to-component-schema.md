# Figma JSON → 组件库 Schema → Agent → ti-component-skills → 最终代码

## 一、目标

让 `convert-figma-to-code` MCP 工具的输出从「裸 Figma 节点 JSON」升级为「带组件库 hint 的 Figma 节点 JSON」：每个 INSTANCE 节点上挂一个 `tiComponent` 字段，告诉下游 agent 该用什么组件（TiComponents / Element Plus），未映射的显式标 `unmapped`。如果 map 中人工配置了 `target.props`，运行时会把它注入到 `tiComponent.variantProps`；`variantProps` 是显式覆盖项，不是完整 props 白名单。未覆盖的 props 再由 agent 调用 `ti-component-skills` 查 API、结合 Figma `componentProperties` 自行映射，产出最终 Vue 代码。

**不猜测 prop 映射**（沿用 map 的 `strictNoGuessing` 原则）。只有人工配置的 `target.props` 会作为显式例外规则进入运行时。

## 二、现状

### Map 文件（位于 `figma-component-assets-private/mappings/`）

| 文件 | 来源 | fileKey | componentSets | mapped / unresolved / internal |
| --- | --- | --- | --- | --- |
| `b-figma-component-key-map.json` | 【内部公开版】 Titan Design System | `GwYZpatr4RGoRtPMEFONwk` | 60 | 24 / 34 / 2 |
| `d-figma-component-key-map.json` | 主题开发者平台 Design System | `khgCmG4dhk4eEi7eGDhSTw` | 59 | 35 / 22 / 2 |
| `figma-component-key-map.json`（旧） | d 的旧快照（2026-06-29） | — | — | — |

三份 map 的索引键都是 Figma `componentSet.key`（跨文件稳定）。`b` 与 `d` 来自不同 Figma 文件，componentSet.key 互不重叠，**不可混用**。

### 旧 map 的去留

`figma-component-key-map.json` 仍被 `scripts/generate-component-maps.mjs:7,26` 作为生成器 fallback seed 引用（仅当 `b-`/`d-` 输出文件不存在时回退读取）。**运行时不读取**。保留作为生成 fallback，无需删除；实施时不动它。

### Map entry 结构（消费侧关心的字段）

每个 `componentSets[setKey]` 包含：
- `figma.name` / `figma.id` / `figma.key` — debug 标签
- `status`：`mapped` | `unresolved` | `internal`
- `target.library`：`TiComponents` | `Element Plus` | `null`
- `target.component`：`el-button` | `TiRadioGroup` | `null`
- `target.fallbackReason`、`target.evidence`
- `target.props` — 可选，Dashboard 人工配置的显式 props；运行时会输出到 `tiComponent.variantProps`
- `variantToPropsStatus: "not-generated"` — 不自动生成 props 映射，只消费人工配置的显式 props

具体 variant 的 `component.key` 位于每个 `componentSets[setKey].components` 对象内；消费侧需要遍历 `componentSets` 构建 `componentKey → variant / setKey` 索引。具体 variant 配置了 override 时，优先消费 variant 自己的 `target` / `target.props`；否则继承 component set 的 `target` / `target.props`。`looseComponents` 仍以具体 `component.key` 为键，优先直接命中。

### 当前 MCP 输出

`src/index.ts:251` 的 `convert-figma-to-code` 输出简化 Figma JSON + 渲染图 URL + 通用 instructions，**无任何组件库 hint**。

## 三、配置：业务项目根的 `.figma-context-mcp.json`

每个业务项目根目录放一份 `.figma-context-mcp.json`，MCP 启动后从 CWD 向上查找（最多 5 层），找到即加载。

### Schema

```json
{
  "componentMap": {
    "source": "d",
    "overridePath": null,
    "inject": true
  }
}
```

| 字段 | 类型 | 默认 | 语义 |
| --- | --- | --- | --- |
| `source` | `"b"` \| `"d"` \| `"none"` \| `"auto"` | `"auto"` | 选哪份 map 加载 |
| `overridePath` | string \| null | `null` | 自定义 map 文件路径（绝对或相对业务项目根）。优先级最高，覆盖 `source` |
| `inject` | boolean | `true` | `false` 时即使 `source` 有值也不注入，方便临时关闭 |

**`source` 取值**：
- `"b"` → 加载 `mappings/b-figma-component-key-map.json`
- `"d"` → 加载 `mappings/d-figma-component-key-map.json`
- `"none"` → 不注入 `tiComponent`，保持旧行为（纯 Figma JSON）
- `"auto"`（默认）→ 见下文

### `auto` 检测策略

1. 取请求 Figma URL 的 fileKey。
2. 与 `b`、`d` 两份 map 的 `sourceRegistry.source.fileKey` 比对：
   - 命中 `b` 的 fileKey（`GwYZpatr4RGoRtPMEFONwk`）→ 用 `b`
   - 命中 `d` 的 fileKey（`khgCmG4dhk4eEi7eGDhSTw`）→ 用 `d`
3. 都不命中（典型情况：业务文件 fileKey 既不是 b 也不是 d 库本身）→ **不注入 + 顶部提示用户配置**：

```md
## Component Map Notice
No .figma-context-mcp.json found (or source is "auto" and the Figma fileKey did not
match b/d library files). tiComponent hints are NOT injected.

To enable, create .figma-context-mcp.json in your project root:
  { "componentMap": { "source": "b" } }   // 内部公开版 Titan Design System
  { "componentMap": { "source": "d" } }   // 主题开发者平台 Design System
```

> 为什么不回退到 `d`：b/d 来自不同 Figma 文件，componentSet.key 互不重叠，错误猜测会让 agent 拿不到任何 `tiComponent` 而误以为"全 unmapped"，比不注入更糟。显式提示让用户声明。

> 业务文件里 INSTANCE 的 `componentId` 引用的是库文件的 componentSet.key，所以跨文件能查到；fileKey 自检只在用户贴库文件 URL 时精确判定，业务文件场景靠提示 + 用户配置。

### 配置优先级

```
tool 入参 (不新增)  ←  本方案不引入任何 tool 入参
环境变量            ←  本方案不引入任何环境变量
.figma-context-mcp.json
默认 ("auto" → 不注入 + 提示)
```

业务项目通过 `.figma-context-mcp.json` 的 `source` 字段自行组装所需 map，MCP 不额外暴露参数。

## 四、Map 加载与索引

新增 `src/component-map.ts`：

```ts
export type MapSource = 'b' | 'd' | 'none' | 'auto';

export interface ProjectConfig {
  componentMap: {
    source: MapSource;
    overridePath?: string | null;
    inject: boolean;
  };
}

export interface TiComponentHint {
  library: string | null;        // "TiComponents" | "Element Plus" | null
  component: string | null;      // "el-button" | "TiRadioGroup" | null
  status: 'mapped' | 'unmapped' | 'internal';
  sourceStatus?: 'mapped' | 'unresolved' | 'internal' | 'not-found';
  evidence?: string[];
  fallbackReason?: string | null;
  variantProps: Record<string, string> | null; // 人工配置的 target.props；未配置时为 null
  hint: string;                  // 给 agent 的指令文本
}

export class ComponentMap {
  static load(config: ProjectConfig): ComponentMap | null;       // source=none/auto-fail 时返回 null
  static findProjectConfig(cwd: string): ProjectConfig | null;   // 向上查找 .figma-context-mcp.json

  resolveByComponentKey(key: string): TiComponentHint | null;    // INSTANCE 节点用
  resolveBySetKey(key: string): TiComponentHint | null;

  get summary(): {
    source: 'b' | 'd' | 'override';
    fileKey: string | null;
    fileName: string | null;
    mapped: number;
    unresolved: number;
    internal: number;
  };
}
```

### 内存索引构建（启动时或首次请求时一次性）

- `setKey → target`（从 `componentSets[setKey].target` + `status` + `evidence` + `fallbackReason` + `props`）
- `componentKey → variant / target`：先查 `looseComponents[componentKey]`；否则遍历 `componentSets[*].components` 生成 `componentKey → variant`。variant 有 override target 时使用 variant target；否则继承 set 级 target。

`b` 和 `d` 互不混用：一次请求只载入其中一份。`overridePath` 命中时单独加载自定义文件（结构需与 b/d 一致）。

### Hint 文本规则

按 `status` 生成：

- `mapped`：
  > Use `<component>` (`<library>`). If `tiComponent.variantProps` is non-null, apply those map-configured props first; they are explicit overrides, not an exhaustive prop whitelist. Query the `ti-component-skills` skill for remaining prop API decisions.
- `unmapped`：
  > No mapping in `<source>` map. Declare this node as unmapped to the user; do NOT hand-roll a look-alike from visuals.
- `internal`：
  > Internal-only Figma component, not in codegen scope. Skip or treat as unmapped.

## 五、注入逻辑

在 `simplifyNode`（`src/index.ts:396`）里：

```ts
if (
  node.type === 'INSTANCE'
  && node.componentId
  && componentMap
) {
  const hint = componentMap.resolveByComponentKey(node.componentId);
  simplified.tiComponent = hint;
}
```

**只处理 INSTANCE**，不处理 COMPONENT 节点。理由：业务文件里出现的库组件都是 INSTANCE；COMPONENT 节点只出现在库文件本身，那时用户多半在审视库而非生成业务代码，注入反而噪声。

只要 map 已启用，所有带 `componentId` 的 INSTANCE 都注入 `tiComponent`。如果 `componentId` 在当前 map 中找不到，输出 `status: "unmapped"` + `sourceStatus: "not-found"`，避免 agent 把「map 未启用」和「选错 b/d 或 map 缺漏」混淆。

INSTANCE 节点输出示例：

```json
{
  "id": "12091:763",
  "type": "INSTANCE",
  "name": "按钮=Primary Button with Icon, 状态=default",
  "componentId": "566893f9c2f361b5804234328f1e657686079ebe",
  "componentProperties": { "按钮": "Primary Button with Icon", "状态": "default" },
  "tiComponent": {
    "library": "Element Plus",
    "component": "el-button",
    "status": "mapped",
    "evidence": [
      "User confirmed Button maps to Element Plus button.",
      "Figma component set is on the Button 按钮 page.",
      "ti-component-skills/references/component-catalog.md only lists TiWeightButtonGroup for button groups, not a standalone Button component."
    ],
    "fallbackReason": null,
    "variantProps": {
      "type": "primary"
    },
    "hint": "Use el-button (Element Plus). Apply tiComponent.variantProps as explicit map-configured props; they are not an exhaustive prop whitelist. Then query the ti-component-skills skill for any remaining API/prop decisions."
  }
}
```

未命中：

```json
  "tiComponent": {
    "library": null,
    "component": null,
    "status": "unmapped",
    "sourceStatus": "unresolved",
    "evidence": [],
  "fallbackReason": "No explicit TiComponents catalog entry, Element Plus fallback-table entry, or user-confirmed mapping was found for this Figma component set.",
  "variantProps": null,
  "hint": "No mapping in d map. Declare this node as unmapped to the user; do NOT hand-roll a look-alike from visuals."
}
```

## 六、Tool 输出顶部加 map notice

在 `src/index.ts:679` 的 `# Figma Design Data` 头部、`## Context` 之前插入。三种状态：

### 命中 b/d

```md
## Component Map
- **Source**: d (主题开发者平台 Design System)
- **Library fileKey**: khgCmG4dhk4eEi7eGDhSTw
- **Coverage**: 35 mapped / 22 unresolved / 2 internal
- **Config**: .figma-context-mcp.json at /path/to/project/.figma-context-mcp.json
- **Policy**: identity-only; do not hand-roll components for unmapped nodes.
```

### overridePath

```md
## Component Map
- **Source**: override (/path/to/custom-map.json)
- **Coverage**: X mapped / Y unresolved / Z internal
- **Policy**: identity-only; do not hand-roll components for unmapped nodes.
```

### 未配置 / auto 未命中

```md
## Component Map Notice
No .figma-context-mcp.json found (or source is "auto" and the Figma fileKey did not
match b/d library files). tiComponent hints are NOT injected.

To enable, create .figma-context-mcp.json in your project root:
  { "componentMap": { "source": "b" } }   // 内部公开版 Titan Design System
  { "componentMap": { "source": "d" } }   // 主题开发者平台 Design System
```

## 七、更新 Instructions

`src/index.ts:706` 的 Instructions 段加一条（放在现有 4 条之后）：

> 5. **Component Hints**: If a node carries `tiComponent`, you MUST use that exact component (`tiComponent.library` / `tiComponent.component`). If `tiComponent.variantProps` is non-null, apply those map-configured props first; they are explicit overrides, not an exhaustive prop whitelist. Invoke the `ti-component-skills` skill to look up any remaining API/props, and use Figma `componentProperties` to map any other props or values not already covered by `variantProps`. If `tiComponent.status` is `"unmapped"` or `"internal"`, declare the node as unmapped to the user and do not hand-roll a look-alike. If no `tiComponent` field appears on any node, see the Component Map / Component Map Notice section at the top of this output.

## 八、新增 resource

- `figma://component-map/summary`：输出当前已加载 map 的 source / fileKey / fileName / 计数 / policy。便于 agent 自检覆盖度。

实现：在 `setupServer` 里注册，内容取 `ComponentMap.load(currentConfig).summary`。

## 九、同步文档

- `data/overview.md`：加一段说明 `tiComponent` 字段语义，引导 agent 读 `figma://component-map/summary`。
- `data/quickstart.md`：加一节"业务项目接入"，告诉开发者在项目根放 `.figma-context-mcp.json`，列 source 取值与示例。
- `README.md`：同步说明 `.figma-context-mcp.json` 与 b/d 选择机制。

## 十、实施步骤

1. 新增 `src/component-map.ts`：`ProjectConfig` 类型、`ComponentMap.load/findProjectConfig/resolveBy*` + 内存索引构建。
2. 修改 `src/index.ts`：
   - `setupServer` 启动时调用 `ComponentMap.findProjectConfig(process.cwd())` 缓存 config；注册 `figma://component-map/summary` resource。
   - `convert-figma-to-code` tool 内：根据 config 加载 `ComponentMap`；在 `simplifyNode` 里注入 `tiComponent`；在输出头部插 Component Map / Notice 段；Instructions 加第 5 条。
3. 同步 `data/overview.md`、`data/quickstart.md`、`README.md`。
4. 验证（见下）。

## 十一、验证

1. 项目根放 `.figma-context-mcp.json` 设 `source: "d"`，请求含 Button INSTANCE 的业务 URL → 输出 `tiComponent.component === "el-button"`、顶部 Component Map 段显示 d。
2. 改成 `source: "b"` 同一 URL → 同样命中（b 的 Button 也 mapped 到 el-button），`evidence` 来自 b 的 entry。
3. 请求 Link INSTANCE → `status: "unmapped"`、`sourceStatus: "unresolved"`，hint 禁止 hand-roll。
4. 删掉 `.figma-context-mcp.json` → 顶部 Component Map Notice 段提示用户配置，节点上无 `tiComponent` 字段。
5. 设 `source: "none"` → 同 4，但不出现 Notice（用户显式声明不要）。
6. 请求 `figma://component-map/summary` → 返回当前 source / fileKey / 计数。

## 十二、不做的事

- **不**自动生成 `variantToProps`（只消费 Dashboard 人工配置的 `target.props`）。
- **不**自动回退到 el-*（map 已显式标注 `target.library`；未标注的 `unresolved` 不暗中降级）。
- **不**改 map 文件本身（只读消费）。
- **不**新增 MCP tool 入参或环境变量（全部由 `.figma-context-mcp.json` 驱动）。
- **不**处理 COMPONENT 节点，只处理 INSTANCE。
- **不**删除旧 `figma-component-key-map.json`（生成器仍用作 fallback seed）。
