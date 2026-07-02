# Component Map Viewer Dashboard

Dashboard for reviewing and editing Figma component mappings. It reads generated mapping JSON from `assets/mappings/` and displays offline preview images from `app/public/previews/`.

## Start

```bash
pnpm map-viewer:dev
```

Open:

```text
http://localhost:3217/?system=d
http://localhost:3217/?system=b
```

Use `localhost` during local development. IP access can cause Next dev origin / hydration issues.

## Update Plugin JSON

1. Export D-side or B-side component JSON from the Figma plugin.
2. Unzip and replace the matching directory:

```text
assets/d-components/
assets/b-components/
```

3. Confirm `all.json` contains `source.fileKey`.
4. Regenerate maps from the repository root:

```bash
pnpm map:generate
```

Generated files:

```text
assets/mappings/d-figma-component-key-map.json
assets/mappings/b-figma-component-key-map.json
```

Existing reviewed mapping data is preserved when entries can be matched by `figma.key`, `figma.id`, or `page + name`.

## Update Preview Images

Preview files:

```text
app/public/previews/{system}/
app/public/previews/{system}/index.json
```

Set a Figma token in the current shell:

```bash
export FIGMA_ACCESS_TOKEN="YOUR_FIGMA_TOKEN"
```

D-side full serial export:

```bash
pnpm previews:export -- --system d --all --delay-ms 500
```

Export by component name:

```bash
pnpm previews:export -- --system d --name Button
```

Export by component key:

```bash
pnpm previews:export -- --system d --key <componentKey>
```

Only export the component set image, without variants:

```bash
pnpm previews:export -- --system d --name Button --variants false
```

The export script batches Figma image API requests. If a batch fails, it retries node-by-node and prints failed node ids.

## Verify

```bash
pnpm --dir app build
pnpm map-viewer:dev
```

In the Dashboard, check:

- list thumbnails render;
- detail preview renders;
- preview lightbox opens;
- all component images are visible in the lightbox;
- drag pan, button zoom, and Command + wheel zoom work.
