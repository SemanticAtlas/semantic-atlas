# Semantic Atlas

Map your Obsidian vault by meaning, not only by links:

- find the notes close to the one you are writing, and link them;
- search the whole vault by meaning;
- see the overall structure: themes, groups, bridges between themes, change over time;
- compare the content with interest axes you declare yourself;
- discover the missing links between notes that are close but never linked;
- compare the structure you built (links, folders, tags) with the one meaning reveals.

Everything is computed on your device. By default, no data leaves it.

> **Status: early development.** Available today: the [link graph](docs/LINK-GRAPH.md) (global or local, with notes not created yet as an option). The features based on meaning (semantic index, related notes, search, themes, missing links) are not available yet. See [the specification](docs/SPEC.md) and the [changelog](CHANGELOG.md).

## Installation

Not yet published in the community directory. To try a development build, copy `main.js`, `manifest.json` and `styles.css` from a release into `<vault>/<config folder>/plugins/semantic-atlas/`, then enable the plugin in **Settings → Community plugins**.

## Declarations

| Capability | Current version | Planned |
|---|---|---|
| Network | None. | Download of the embedding model from Hugging Face, **only after you click and confirm**; the address, size and license are shown first, the version is fixed and its SHA-256 checked. Optional external providers (OpenAI-compatible endpoint, Ollama), off by default. The model can also be imported from a file, with no network at all. |
| File system | Reads notes' links from Obsidian's metadata cache. Writes only the plugin settings (`data.json`). Creates a note only when you open a note that does not exist yet from the link graph, as clicking an unresolved link does. | Reads notes through the Obsidian API; changes a note only after an explicit action of yours; optional index snapshot in a visible folder of the vault; index cache in IndexedDB on the device. Nothing outside the vault. |
| Clipboard | None. | Writes only when you choose "copy" (list of links, context for an assistant). Never reads it. |
| Other capabilities | WebAssembly (the Semantic Atlas engine, embedded in `main.js`) and a canvas for the link graph. | Web Workers and WebAssembly bundled in `main.js`; WebGL for maps. |

## Credits

The link graph uses [@semanticatlas/core](https://github.com/SemanticAtlas/semantic-atlas-core) and [@semanticatlas/engine](https://github.com/SemanticAtlas/semantic-atlas-engine) (MIT, same author), bundled in `main.js`.

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
