# Future Token Capability

This folder archives the design token capability that used to run inside `convert-figma-to-code`.

The current product focus is Component Map Viewer: Figma component registry JSON, component mapping files, and offline preview images. Token resolution is intentionally removed from the runtime path for now.

## Archived Files

| File | Purpose |
| --- | --- |
| `token-utils.ts` | Original token registry loader and Figma `boundVariables` resolver. |
| `config-utils.ts` | Original `.figma-context-mcp.json` project config resolver. |
| `overview.with-token.md` | Previous MCP resource overview with token behavior documented. |
| `quickstart.with-token.md` | Previous quickstart with token setup and usage examples. |

## What The Archived Token Code Did

The token flow resolved Figma variable aliases into implementation-ready CSS variable values:

1. Read token configuration from tool args, `.figma-context-mcp.json`, or env vars.
2. Locate token files from `TI_DESIGN_TOKEN_DIR` and token set id such as `d` or `b`.
3. Load Figma variable JSON, CSS variable metadata, and remote variable alias maps.
4. Walk each Figma node's `boundVariables`.
5. Promote Semantic / Component variables to `tokenBindings`.
6. Report unsupported or missing bindings as `tokenGaps`.
7. Wrap style values so code generation could prefer `var(--...)` values.

## Removed Runtime Touchpoints

The active `src/index.ts` no longer imports or calls these archived APIs:

```ts
loadFigmaContextConfig()
loadTokenRegistry()
extractNodeTokenContext()
createTokenUsageSummary()
createStyleValue()
findBindingForPath()
findGapForPath()
formatFigmaColor()
```

The active MCP tool schema also no longer exposes:

```text
styleStrategy
tokenDetail
designTokenDir
tokenSetId
variablesTokenFile
cssVariablesFile
variableAliasFile
```

## Restore Plan

When token capability becomes relevant again:

1. Move or copy `token-utils.ts` and `config-utils.ts` back into `src/`.
2. Re-add the imports in `src/index.ts`.
3. Re-add token-related tool parameters to `convert-figma-to-code`.
4. Load project config and token registry before fetching/simplifying nodes.
5. Reconnect token context inside `simplifyNode`.
6. Re-add token guidance to the final MCP response.
7. Restore token sections in `data/overview.md`, `data/quickstart.md`, and `README.md`.
8. Run:

```bash
npm run build
pnpm --dir app build
```

## Current Expected Behavior

Without restoring this folder, the runtime tool should:

- require only `FIGMA_ACCESS_TOKEN`;
- fetch Figma node JSON and preview image;
- simplify Figma design data using literal values;
- strip `boundVariables` and `explicitVariableModes` by default;
- optionally include compact raw variable fields with `includeVariables`;
- never emit `tokenBindings` or `tokenGaps`.
