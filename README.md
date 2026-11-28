# Semantic Atlas

Map your Obsidian vault by meaning, not only by links:

- find the notes close to the one you are writing, and link them;
- search the whole vault by meaning;
- see the overall structure: themes, groups, bridges between themes, change over time;
- compare the content with interest axes you declare yourself;
- discover the missing links between notes that are close but never linked;
- compare the structure you built (links, folders, tags) with the one meaning reveals.

Everything is computed on your device. By default, no data leaves it.

> **Status: early development.** Available today:
> - the [link graph](docs/LINK-GRAPH.md), global or local, with notes not created yet as an option;
> - the [semantic index](docs/SEMANTIC-INDEX.md): related notes, search by meaning, random close note;
> - the [landscape](docs/LANDSCAPE.md): map of the themes, clusters you can rename, themes over time, interest axes and the quality of the analysis.
>
> Missing links and the free exploration views are not available yet. See [the specification](docs/SPEC.md) and the [changelog](CHANGELOG.md).

## Installation

Not yet published in the community directory. To try a development build, copy `main.js`, `manifest.json` and `styles.css` from a release into `<vault>/<config folder>/plugins/semantic-atlas/`, then enable the plugin in **Settings → Community plugins**.

## Declarations

| Capability | Current version | Planned |
|---|---|---|
| Network | Only to download the embedding model, **once, after you click and confirm**. The files come from `github.com` (release `granite-r2-q8_0-v1` of SemanticAtlas/semantic-atlas-models), which redirects to `release-assets.githubusercontent.com`. The address, size and license are shown first, the version is fixed, and each file's SHA-256 is checked. Nothing about your notes is sent. The model can also be imported from files, with no network at all. | Optional external providers (OpenAI-compatible endpoint, Ollama), off by default. |
| File system | Reads notes through Obsidian (cached content and metadata cache). Writes only the plugin settings (`data.json`). The model and the index are kept in the app's IndexedDB on this device, outside the vault. Creates a note only when you open a note that does not exist yet from the link graph, as clicking an unresolved link does. | Reads notes through the Obsidian API; changes a note only after an explicit action of yours; optional index snapshot in a visible folder of the vault; index cache in IndexedDB on the device. Nothing outside the vault. |
| Clipboard | Writes only when you click **Copy as links** in Related notes. Never reads it. | Writes only when you choose "copy" (list of links, context for an assistant). Never reads it. |
| Other capabilities | WebAssembly (the Semantic Atlas engine and its embedding module, embedded in `main.js`), a background Web Worker for embeddings, IndexedDB, and a canvas for the link graph. | Web Workers and WebAssembly bundled in `main.js`; WebGL for maps. |

## Credits

Bundled in `main.js`:

- [@semanticatlas/core](https://github.com/SemanticAtlas/semantic-atlas-core) and [@semanticatlas/engine](https://github.com/SemanticAtlas/semantic-atlas-engine) (MIT, same author). The engine's embedding module uses [Candle](https://github.com/huggingface/candle) (MIT or Apache-2.0).
- [@huggingface/tokenizers](https://github.com/huggingface/tokenizers.js) (Apache-2.0).
- [MiniSearch](https://github.com/lucaong/minisearch) (MIT).

Downloaded on request: [granite-embedding-97m-multilingual-r2](https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2), Copyright IBM Corp., Apache-2.0. It is converted to GGUF Q8_0 by Semantic Atlas; see the release's NOTICE.

## Privacy

No telemetry, no account, no ads, no paid features.

## Development

Requires Node.js 22.12 or later and [just](https://github.com/casey/just).

```sh
just install   # npm ci
just check     # lint, types, tests, build, size budget, reproducibility, llms.txt
just dev       # rebuild on change
```

Documentation for tools and language models: [`llms.txt`](llms.txt), [`llms-full.txt`](llms-full.txt).

## License

[MIT](LICENSE) © Sébastien Celles. Part of the [Semantic Atlas](https://github.com/SemanticAtlas) project.
