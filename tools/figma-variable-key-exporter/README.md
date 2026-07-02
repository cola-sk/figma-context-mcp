# TI Variable Key Exporter

Local Figma plugin for exporting Design System Variables with both:

- `id`, for local token/CSS variable mapping
- `key`, for matching business-file remote bound variable ids such as `VariableID:<key>/<suffix>`

Run this plugin in the Design System source file, not in a business design file.

## Install

1. Open Figma Desktop.
2. Open the Design System file, for example `Example Design System`.
3. Go to `Plugins -> Development -> Import plugin from manifest...`.
4. Select:

   ```text
   tools/figma-variable-key-exporter/manifest.json
   ```

## Export

1. Run `Plugins -> Development -> TI Variable Key Exporter`.
2. Click `Download All Collections`.
3. Unzip `ti-figma-variable-collections.zip`.
4. Save/replace the files under:

   ```text
   figma-component-assets-private/tokens/
   ```

   包含 `Primitive.json` / `Semantic.json` / `Component.json`。当前 MCP 不消费这些 JSON，仅作为本地参考数据归档。

`Download All Collections` intentionally downloads a single zip. Figma Desktop can block repeated file downloads from one plugin click, which may otherwise leave you with only `Primitive.json`.

Use `Download Current` only when you want to replace one selected collection. Use `Download Bundle` only for debugging; the build currently expects the three collection JSON files above.

## Expected Variable Shape

Each exported variable should include `key`:

```json
{
  "id": "VariableID:11111:222",
  "key": "abcdef0123456789abcdef0123456789abcdef01",
  "name": "Token name",
  "type": "COLOR",
  "valuesByMode": {}
}
```

After rebuilding, the MCP can resolve:

```text
VariableID:abcdef0123456789abcdef0123456789abcdef01/33333:444
  -> key abcdef0123456789abcdef0123456789abcdef01
  -> VariableID:11111:222
  -> var(--token-...)
```

> 备注：当前 MCP 暂未接入该解析链路，上述为预期设计。
