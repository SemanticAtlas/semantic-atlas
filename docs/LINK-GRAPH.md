# Link graph

The link graph shows the explicit links between your notes, laid out by a force simulation: linked notes pull together, and every note pushes the others away.

## Open it

| Command | Opens |
|---|---|
| **Open link graph** | The whole vault, in a new tab |
| **Open local link graph** | The notes around the active note, in the right sidebar. It follows the note you open. |

No shortcut is assigned by default. You can set one in **Settings → Hotkeys**.

## Controls

- **Local graph**: shows only the notes within **Depth** links (1 to 3) of the active note, following links in both directions.
- **Show notes not created yet**: draws the targets of links to notes that do not exist yet as hollow "ghost" notes.
- The view remembers these choices, even after a restart.

## Reading the graph

| Element | Meaning |
|---|---|
| Solid line | Link (`[[note]]` or `[text](note.md)`) |
| Dashed line | Embed (`![[note]]`) |
| Dotted line | Link in a property (front matter) |
| Dash-dotted line, hollow node | Link to a note that does not exist yet |
| Arrowhead | Direction of the link |
| Larger node | More links |
| Ring | Selected note, or the note the local graph is centred on |

The status line under the graph counts the notes, the links and the unresolved links. Under it, a table lists every note with the notes it links to and the notes that link to it. It gives the same information as the drawing, for keyboard and screen-reader users.

## Interaction

| Action | Mouse or touch | Keyboard (graph focused) |
|---|---|---|
| Select a note and highlight its neighbours | Click | `n` / `p`: next / previous note |
| Open a note | Double-click | Enter, or a button in the table |
| Move a note | Drag it (hold Shift to keep it in place) | — |
| Pan | Drag the background | Arrow keys |
| Zoom | Wheel | `+` / `-`; `0` shows everything |
| Clear the selection | — | Escape |

From a tab, notes open in a new tab; from the sidebar, they open in the main area. Opening a ghost note creates it, as clicking an unresolved link does: only that explicit action changes your vault.

## Details

- **Source of the links**: Obsidian's metadata cache (links, embeds and front-matter links). The plugin does not parse your Markdown itself. Two links from one note to another with the same kind and syntax count as one edge, with their number of occurrences.
- **Attachments**: links to images, PDF files and other attachments are left out for now. The graph shows notes only.
- **Updates**: the graph is rebuilt a second after Obsidian has finished resolving the links of a change.
- **Theme**: colours come from the theme, through the `--graph-node`, `--graph-line`, `--graph-text` and `--interactive-accent` variables, and are re-read when the theme changes.
- **Reduced motion**: with your system's reduced-motion setting, the layout is computed out of sight and only the final state is drawn. Otherwise the animation stops as soon as the layout is stable, and nothing runs at rest.
- **Engine**: the layout is computed by the Semantic Atlas engine (Rust compiled to WebAssembly), embedded in the plugin. Nothing is downloaded.

## Tested

In Obsidian 1.15.1 (desktop, Linux) on a generated test vault: global and local graphs, ghost notes, saved view state, light and dark themes, sidebar and main area, reloading the plugin (nothing left behind), with no console error. Not tested yet: mobile, popout windows, large vaults.

## Limits of this version

- The drawing is Canvas 2D and the simulation runs in the interface thread. That suits a few thousand notes; larger vaults will get WebGL and a worker.
- Notes are not coloured by theme yet: clustering by meaning comes with the semantic index.
- There is no long-press pinning on touch screens.
