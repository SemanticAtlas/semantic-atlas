# Architecture

This page describes the code as it is. The target architecture is in [SPEC.md, section 4](SPEC.md#4-organisation-des-dépôts-et-architecture).

## Repositories

| Repository | Role |
|---|---|
| [semantic-atlas](https://github.com/SemanticAtlas/semantic-atlas) | This Obsidian plugin |
| [semantic-atlas-core](https://github.com/SemanticAtlas/semantic-atlas-core) | Obsidian-independent core (graph model, search, embeddings, analysis, layouts, physics, rendering) |
| [semantic-atlas-pwo](https://github.com/SemanticAtlas/semantic-atlas-pwo) | Component for progressive-web-office |
| [semanticatlas.github.io](https://github.com/SemanticAtlas/semanticatlas.github.io) | Website and documentation |
| [.github](https://github.com/SemanticAtlas/.github) | Organization profile and shared community files |

## Modules (current)

| Path | Role | Depends on Obsidian |
|---|---|---|
| `src/main.ts` | Plugin lifecycle: language, settings, settings tab | yes |
| `src/settings/schema.ts` | Versioned settings schema and migrations | no |
| `src/settings/tab.ts` | Settings tab | yes |
| `src/i18n/` | English and French strings, locale choice | no |
| `src/log.ts` | Console output, silent unless debug mode is on | no |
| `src/adapter/collect.ts` | Notes and references to the neutral graph data (edges counted by target, kind and syntax) | no |
| `src/adapter/vault.ts` | Reads links, embeds and front-matter links from `metadataCache`; link resolver | yes |
| `src/views/relations.ts` | Link graph view (`ItemView`), state saved with `getState`/`setState` | yes |
| `src/adapter/note-input.ts` | Note content + metadata cache to the core's `NoteInput` (offsets without front matter, sections, link spans, dates) | no |
| `src/indexing/plan.ts` | Exclusions, order of work, settings hash | no |
| `src/indexing/service.ts` | Semantic index: model download (requestUrl with Range), embedding worker, incremental indexing, search, related notes | yes |
| `src/views/related.ts`, `search-modal.ts`, `model-modal.ts` | Related notes view, search, model and clear-data dialogs | yes |

The embedding worker (`@semanticatlas/core/embed-worker`) is bundled on its own by esbuild, inlined in `main.js` as text and started from a blob URL. The engine's `embed.wasm` is embedded (esbuild `binary` loader) and handed to the worker. The model files come from IndexedDB.

The link graph uses `RelationsView` from `@semanticatlas/core`. The engine's WebAssembly module is embedded in `main.js` (esbuild `binary` loader) and loaded on first use, not at start-up. Both packages are git dependencies pinned to their distribution tags.

## Settings format (`data.json`)

```json
{ "version": 2, "debug": false, "index": { "enabled": false, "onMobile": false, "titleWeight": 0.2, "maxChunkTokens": 256, "overlapTokens": 32, "minTokens": 8, "excludeFolders": [], "excludeTags": [], "includeCode": false, "dateProperty": "", "workers": 1 } }
```

- `version` (integer): schema version. Missing means version 0, migrated to 1 with the fields kept; version 1 is migrated to 2 by adding `index` with its defaults.
- A version newer than the installed plugin is read but never overwritten, so a downgrade does not destroy settings.
- A field of the wrong type is replaced by its default, and the corrected file is saved.
- When `data.json` changes on disk (for example after a sync), the settings are reloaded.

## Build

`npm run build` type-checks, then bundles `src/main.ts` into a single `main.js` (CommonJS, ES2021, minified, licenses kept at the end). The build is reproducible: CI builds twice and compares the SHA-256, because the community directory rebuilds the plugin and compares it with the release.
