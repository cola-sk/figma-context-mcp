# Component Registry Exporter

用于从 Figma Design System 文件批量导出组件 JSON，并用 `componentSet.key` / `component.key` 建立稳定关联。

## 使用方式

1. 打开 Figma。
2. 进入 `Plugins > Development > Import plugin from manifest...`。
3. 选择本目录下的 `manifest.json`。
4. 打开 Design System 文件后运行 `Component Registry Exporter`。
5. 选择导出类型：
   - `组件注册表 registry`：给 MCP / 代码生成用，只导出组件身份、key、variant 和索引。
   - `设计规格 design-spec`：给设计校验 / token 校验用，额外导出样式、变量绑定和内部节点树。
6. 勾选要扫描的 page。非 `↳` 开头的 page 会作为分隔行展示，不参与导出；分隔行右侧可一键选择到下一个分隔行之前的全部页面。
7. 如果界面顶部显示 `fileKey: unavailable`，在 `Figma URL / fileKey` 输入框粘贴当前 Figma 文件链接或 fileKey。
8. 点击 `导出 ZIP`。

## 关联规则

不要使用 `name` 作为主关联字段。

推荐优先级：

```text
组件族识别：componentSet.key
具体变体识别：component.key
变体属性补充：componentProperties / variantProperties
名称：仅作为 debug label
```

示例：

```json
{
  "componentSetKey": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
  "componentSetName": "Table",
  "target": {
    "component": "ExampleTable",
    "source": "ExampleComponents"
  }
}
```

```json
{
  "componentSetKey": "0123456789abcdef0123456789abcdef01234567",
  "componentSetName": "Tag-Sample",
  "target": {
    "component": "el-tag",
    "source": "element-plus",
    "fallbackReason": "ExampleComponents has no standalone Tag"
  }
}
```

## 输出结构

`组件注册表 registry` 输出：

```json
{
  "schemaVersion": "figma-component-registry/v1",
  "source": {
    "fileName": "Example Design System",
    "fileKey": "FIGMA_FILE_KEY",
    "currentPage": "Components",
    "scope": "selected-pages"
  },
  "stats": {
    "componentSetCount": 1,
    "looseComponentCount": 0,
    "componentCount": 6
  },
  "componentSets": [],
  "looseComponents": [],
  "indexes": {
    "componentSetByKey": {},
    "componentByKey": {}
  }
}
```

`设计规格 design-spec` 输出：

```json
{
  "schemaVersion": "figma-component-design-spec/v1",
  "source": {
    "fileName": "Example Design System",
    "fileKey": "FIGMA_FILE_KEY",
    "currentPage": "Components",
    "scope": "selected-pages"
  },
  "stats": {
    "componentSetCount": 1,
    "looseComponentCount": 0,
    "componentCount": 6
  },
  "componentSets": [
    {
      "key": "0123456789abcdef0123456789abcdef01234567",
      "name": "Tag-Sample",
      "components": [
        {
          "key": "fedcba9876543210fedcba9876543210fedcba98",
          "name": "Property 1=green",
          "variantProperties": {
            "Property 1": "green"
          },
          "design": {
            "boundVariables": {}
          }
        }
      ]
    }
  ]
}
```

## 说明

- 插件运行在 Figma 内部，只负责导出当前打开文件里的 Design System 组件定义。
- `source.fileKey` 可用于后续通过 Figma Images API 下载组件截图。
- 插件会优先自动读取 `figma.fileKey`；如果不可用，可手动输入 Figma 文件链接或 fileKey 作为兜底。
- `registry` 不导出视觉样式，适合进入默认代码生成链路。
- `design-spec` 会导出视觉样式、变量 key 和内部节点树，适合做设计 / token / 组件库一致性校验。
- 页面选择模式会逐页加载，并显示当前页、页内组件数和累计组件数。
- 点击下载时会生成 zip：
  - `index.json`：zip 内文件索引和总统计。
  - `all.json`：完整合并后的导出结果。
  - `pages/*.json`：按 Figma page 拆分后的导出结果。
- 插件不会直接写入仓库文件；请使用 UI 下载 ZIP。
