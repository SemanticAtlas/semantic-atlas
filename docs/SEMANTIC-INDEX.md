# Semantic index

The semantic index finds notes by their meaning, in French and English alike. It runs on your device with a local embedding model: your notes never leave it.

## Set it up

1. Run **Set up the semantic index**, or turn on **Index this vault** in the settings.
2. A dialog shows the model (granite-embedding-97m-multilingual-r2 by IBM, Apache-2.0), its size (128.9 MB), where it comes from (release `granite-r2-q8_0-v1` of [SemanticAtlas/semantic-atlas-models](https://github.com/SemanticAtlas/semantic-atlas-models)) and where it is kept.
3. **Download and index** downloads the three files of the model in ranges, checks their SHA-256, keeps them on this device, then indexes the vault. Without network, **Import files…** accepts the same three files downloaded elsewhere; they are recognised by their SHA-256.

Nothing is downloaded before you click. The model is never updated silently: a new model can only come with a new version of the plugin, and you choose whether to download it.

## Use it

| Command | What it does |
|---|---|
| **Open related notes** | Sidebar view: the notes closest in meaning to the active note, with the passage that makes them close. |
| **Search by meaning** | Search all notes by meaning and words together. Results show the best passage. |
| **Open a random close note** | Opens one of the 10 notes closest to the active note. |
| **Pause indexing** / **Resume indexing** | Stops or restarts the background work. |
| **Clear all data of the plugin** | Deletes this vault's index, and optionally the model, from this device. |

In **Related notes**:

- drag a title into the editor to insert a link, in your link format;
- **Hide notes already linked** leaves out the notes linked from or to the active note;
- the copy button copies the list as links;
- the pause button stops following the active note.

The score is the cosine similarity between notes. It ranks the results of one note, but it has no absolute meaning and is not comparable from one note to another.

## How it works

- **Text**: each note is read through Obsidian (the cached content and metadata cache). The front matter is dropped. Code blocks and embedded queries (Dataview, Tasks, Bases) are left out; links are replaced by their displayed text.
- **Passages**: the text is cut at headings into passages of up to 256 tokens, with an overlap of 32. Each passage carries its heading path.
- **Note vector**: the passages and the title (with aliases) are embedded by the model in a background worker. A note's vector is 20 % title and 80 % the mean of its passages, weighted by length.
- **Incremental**: notes are re-indexed when their content changes (content hash, two seconds after the last change), renamed or deleted. The active note goes first, then the most recently modified.
- **Search**: passages by meaning and words (BM25, accents folded, French and English stop words), merged by rank (reciprocal rank fusion).
- **Storage**: vectors are kept in IndexedDB on this device. They are not in your vault and not synced. Changing the passage length, the title weight or the code-block option rebuilds the index.

## Measured

- **Indexing**: in Obsidian 1.15.1 (Linux, one core for the worker), 480 Wikipedia introductions in French and English (about 185 words each) took about 4 minutes, roughly 2 notes per second.
- **Reload**: after a reload, the index was ready in 2.2 s without recomputing anything.
- **Model quality**: see spike S2 in [semantic-atlas-core](https://github.com/SemanticAtlas/semantic-atlas-core/tree/main/spikes/s2-quality). The model is close to blind to language: a French note and an English note on the same subject are neighbours.

## Limits of this version

- Indexing a large vault takes time: about 2 notes per second, so 20,000 notes take hours. It runs in the background and can be paused.
- **Mobile**: off by default (memory and battery). The index of a desktop is not shared with the phone yet.
- **Related notes view**: pinning or hiding a result is not available yet.
- **Search**: no stemming yet.
