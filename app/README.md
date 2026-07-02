# Component Map Viewer Dashboard

用于查看和编辑 Figma 组件到 Vue 组件库的映射关系。

Dashboard 只负责可视化和人工校验。业务 JSON、映射文件和组件截图统一从仓库根目录的 `figma-component-assets-private/` 读取，该目录已被 gitignore，未来可以替换为 private submodule。

## 启动

```bash
pnpm map-viewer:dev
```

打开：

```text
http://localhost:3217/?system=d
http://localhost:3217/?system=b
```

本地开发建议使用 `localhost`。用 IP 访问时，Next dev 的 origin / hydration 行为可能不一致。

## 业务资产目录

默认目录：

```text
figma-component-assets-private/
├── d-components/
├── b-components/
├── mappings/
└── previews/
```

如果资产目录不在默认位置，可以在启动前设置：

```bash
export FIGMA_COMPONENT_ASSETS_DIR="/path/to/figma-component-assets-private"
```

## 更新插件 JSON

组件 JSON 来自仓库里的 Figma 插件：

```text
tools/figma-component-registry-plugin/
```

在 Figma 中执行：

1. 进入 `Plugins > Development > Import plugin from manifest...`。
2. 选择 `tools/figma-component-registry-plugin/manifest.json`。
3. 打开 Design System 文件后运行 `Component Registry Exporter`。
4. 导出类型选择 `组件注册表 registry`。
5. 勾选要导出的组件 page。
6. 如果界面显示 `fileKey: unavailable`，手动填入当前 Figma 文件链接或 fileKey。
7. 点击 `导出 ZIP`。

ZIP 解压后会包含：

```text
index.json
all.json
pages/*.json
```

将解压后的内容替换到对应目录：

```text
figma-component-assets-private/d-components/
figma-component-assets-private/b-components/
```

确认 `all.json` 中包含 `source.fileKey`。后续导出截图会用这个 fileKey 调 Figma Images API。

回到仓库根目录重新生成映射：

```bash
pnpm map:generate
```

生成文件：

```text
figma-component-assets-private/mappings/d-figma-component-key-map.json
figma-component-assets-private/mappings/b-figma-component-key-map.json
```

重新生成时会按 `figma.key`、`figma.id`、`page + name` 继承已有映射，避免丢失已经确认过的 mapping。

## 更新截图

截图目录：

```text
figma-component-assets-private/previews/{system}/
figma-component-assets-private/previews/{system}/index.json
```

设置 Figma token：

```bash
export FIGMA_ACCESS_TOKEN="YOUR_FIGMA_TOKEN"
```

D 端全量串行导出：

```bash
pnpm previews:export -- --system d --all --delay-ms 500
```

按组件名导出：

```bash
pnpm previews:export -- --system d --name Button
```

按 component key 导出：

```bash
pnpm previews:export -- --system d --key <componentKey>
```

只导出 component set，不导出 variants：

```bash
pnpm previews:export -- --system d --name Button --variants false
```

脚本会批量调用 Figma image API。如果批量请求失败，会自动按单个节点重试并打印失败节点。

## 验证

```bash
pnpm --dir app build
pnpm map-viewer:dev
```

在 Dashboard 中检查：

- 列表缩略图可以加载；
- 详情区预览图可以加载；
- 点击图片可以打开大图弹窗；
- 大图弹窗里组件及 variants 都可见；
- 拖拽平移、按钮缩放、Command + 滚轮缩放可用。
