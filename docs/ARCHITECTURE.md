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
| `src/analysis/snapshot.ts`, `quality.ts`, `tables.ts`, `docs.ts` | Snapshot of an analysis and names given by hand, quality report, tables over time and against axes, text used for names | no |
| `src/analysis/service.ts` | Runs the analysis in its worker after indexing, keeps the result and snapshot, renames clusters, embeds the axes | yes |
| `src/views/landscape.ts` | Landscape view: map, clusters, over time, axes, quality panel | yes |
| `src/explorer/submap.ts` | Notes of a sub-map (cluster, folder, tag, notes shown, drift path; 20 to 2,000) | no |
| `src/explorer/variables.ts` | Values of "Colour by" and "Size by" for each note, shared words of two notes | no |
| `src/views/explorer.ts` | Explorer view: map, card, suggested links and their actions, drift | yes |

The embedding worker (`@semanticatlas/core/embed-worker`) and the analysis worker (`@semanticatlas/core/analysis-worker`) are bundled on their own by esbuild, inlined in `main.js` as text and started from blob URLs. The analysis worker receives a copy of the engine's `engine.wasm`. The engine's `embed.wasm` is embedded (esbuild `binary` loader) and handed to the worker. The model files come from IndexedDB.

The link graph uses `RelationsView` from `@semanticatlas/core`. The engine's WebAssembly module is embedded in `main.js` (esbuild `binary` loader) and loaded on first use, not at start-up. Both packages are git dependencies pinned to their distribution tags.

## Settings format (`data.json`)

```json
{ "version": 3, "debug": false, "index": { "enabled": false, "onMobile": false, "titleWeight": 0.2, "maxChunkTokens": 256, "overlapTokens": 32, "minTokens": 8, "excludeFolders": [], "excludeTags": [], "includeCode": false, "dateProperty": "", "workers": 1 }, "analysis": { "resolution": 1, "axes": [{ "name": "Music", "description": "instruments, jazz, concerts" }], "names": [{ "name": "My name", "anchors": ["Music/Jazz.md", "Music/Bebop.md"] }], "dateSource": "modified" } }
```

- `version` (integer): schema version. Missing means version 0, migrated to 1 with the fields kept; version 1 is migrated to 2 by adding `index` with its defaults, and version 2 to 3 by adding `analysis`. `analysis.names` holds the names given by hand, each with the paths of the most central notes of its cluster (cluster identifiers are local to a device).
- A version newer than the installed plugin is read but never overwritten, so a downgrade does not destroy settings.
- A field of the wrong type is replaced by its default, and the corrected file is saved.
- When `data.json` changes on disk (for example after a sync), the settings are reloaded.

## Build

`npm run build` type-checks, then bundles `src/main.ts` into a single `main.js` (CommonJS, ES2021, minified, licenses kept at the end). The build is reproducible: CI builds twice and compares the SHA-256, because the community directory rebuilds the plugin and compares it with the release.
