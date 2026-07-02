# TI Variable Key Exporter

本地 Figma 插件，用于导出 Design System Variables，同时带：

- `id`，用于本地 token / CSS 变量映射
- `key`，用于匹配业务文件中的远程 bound variable id，例如 `VariableID:<key>/<suffix>`

请在 Design System 源文件中运行本插件，不要在业务设计文件中运行。

## 安装

1. 打开 Figma Desktop。
2. 打开 Design System 文件，例如 `Example Design System`。
3. 进入 `Plugins -> Development -> Import plugin from manifest...`。
4. 选择：

   ```text
   tools/figma-variable-key-exporter/manifest.json
   ```

## 导出

1. 运行 `Plugins -> Development -> TI Variable Key Exporter`。
2. 点击 `Download All Collections`。
3. 解压 `ti-figma-variable-collections.zip`。
4. 将文件保存/替换到：

   ```text
   figma-component-assets-private/tokens/
   ```

   包含 `Primitive.json` / `Semantic.json` / `Component.json`。当前 MCP 不消费这些 JSON，仅作为本地参考数据归档。

`Download All Collections` 故意下载单个 zip。Figma Desktop 会拦截同一插件点击中的多次文件下载，否则可能只拿到 `Primitive.json`。

仅在替换某个选中 collection 时使用 `Download Current`。`Download Bundle` 仅用于调试；构建当前只期望上述三个 collection JSON 文件。

## 导出 Variable 形状

每个导出的 variable 应包含 `key`：

```json
{
  "id": "VariableID:11111:222",
  "key": "abcdef0123456789abcdef0123456789abcdef01",
  "name": "Token name",
  "type": "COLOR",
  "valuesByMode": {}
}
```

rebuild 之后，MCP 可以解析：

```text
VariableID:abcdef0123456789abcdef0123456789abcdef01/33333:444
  -> key abcdef0123456789abcdef0123456789abcdef01
  -> VariableID:11111:222
  -> var(--token-...)
```

> 备注：当前 MCP 暂未接入该解析链路，上述为预期设计。
