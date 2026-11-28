# Explorer

The explorer shows every analysed note on a map, placed by meaning, with the variables and links you choose. It needs the [semantic index](SEMANTIC-INDEX.md) and an analysis (see [the landscape](LANDSCAPE.md)). Nothing leaves your device; a note is changed only when you press **Link** on a suggestion.

Run **Open the explorer**, or **Open in the explorer, centred on this note** from a note.

## Map

- **Colour by**: cluster, folder, main tag (the note's tag used by the most notes), role (core of its cluster, connector, peripheral), bridge (participation coefficient), isolation, precursor, recent activity, date, relevance to the interest axes (when axes are declared), page rank. Numbers use a colour-blind-safe scale by rank; notes without a value are grey and counted in the legend ("no value"), never shown as zero.
- **Size by**: links, page rank, centrality in its cluster, recent activity, or the same size.
- **Legend**: hover an entry to highlight its notes; select it to show them alone.
- **Links shown**: links, embeds, properties and suggested links (dashed), each on or off. With many links, only those of the hovered or selected note are drawn.
- **Navigation**: drag to move, wheel or pinch to zoom, **Show everything** to fit the map. Click a note to select it, double-click to open it. With the keyboard, on the map: arrows move, + and − zoom, 0 shows everything, N and P select the next and previous note (announced), Enter opens it, Escape clears the selection.
- The display choices are saved with the view.

## Card of the selected note

The start of its text, its cluster, role and isolation, its closest notes with their similarity, and its links in and out. Click a name to select it on the map; Ctrl or Cmd-click to open it.

## Suggested links

Pairs of notes close in meaning that are not linked, with their reasons: similarity, words both notes contain (the rarest first), notes linked to both, shared tags, and, on demand, the two closest passages. A pair already two links apart is flagged.

Before ranking them, the score is **checked on your own links**: 20 % of them are hidden, and the panel tells whether the score finds them again better when it also counts shared neighbours and tags than with similarity alone. The combination is used only when it clearly wins (at least 0.02 of AUC, without losing precision); with fewer than about 150 links there is not enough to check, and similarity alone is used. See the core's `docs/LINKS.md` and [METRICS.md](METRICS.md).

Three actions:

- **Link** adds a link to the second note on a new line at the end of the first one, in your link format;
- **Not related** and **Ignore** hide the pair.

Your decisions are saved in the plugin's settings (they follow renamed notes) and the pair is never suggested again. Near duplicates are listed in the landscape's quality panel, not here. In a bilingual vault, a note and its translation often come first: link them if you wish.

## Drift

**Drift** walks from the selected note (or a random one) to the most similar note not visited yet, one step every 0.1 to 10 seconds (**Step**); the map follows. The path is listed with the similarity of each step and can be copied as a list of links.

## Sub-maps

**Sub-map** maps a part of the vault on its own, with its own clusters, names, layout and suggested links: the cluster, folder or main tag of the selected note, the notes shown (after a filter or a legend selection), or the drift path. A sub-map holds 20 to 2,000 notes, and can be split again. The trail above the map goes back to any level. Sub-maps are computed on demand and not saved; names given by hand apply to the whole vault's clusters only.

## Coming next

Projections (t-SNE, UMAP, PaCMAP) with their measured quality. Today the map uses the landscape's layout.
