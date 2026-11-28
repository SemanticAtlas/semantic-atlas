# Landscape

The landscape shows the vault by meaning: the themes your notes form, how they sit next to each other, how they grew over time and how close they are to the interests you declare. It needs the [semantic index](SEMANTIC-INDEX.md); nothing leaves your device and no note is ever changed.

Run **Open the landscape**. The analysis runs by itself in the background a few seconds after the index is ready, then 30 seconds after the index last changed. **Update the analysis** (command, or the button of the view) runs it now. It needs at least 10 indexed notes.

## Tabs

| Tab | What it shows |
|---|---|
| **Map** | Every note as a point, coloured by cluster; close points have close meanings. The cluster names sit at their centres. Click a note to open it; select a cluster in the legend to show it alone; filter by title words. Zoom with the wheel or pinch, move by dragging; the arrow keys move between notes and Enter opens one. The list under the map gives the same content to the keyboard and screen readers. Positions start from the previous ones, so the map changes little when a few notes change. |
| **Clusters** | One card per cluster: its name, size, stability, the notes that connect it to other clusters, its distinctive terms and its most central notes. The pencil button renames it; a name given by hand can be given back to the keyword name. |
| **Over time** | Notes per cluster and per year, quarter or month, by the date chosen in the settings (last modification by default, creation, or a property of the notes). Undated notes are counted apart. |
| **Axes** | For each interest axis declared in the settings, how close each cluster is (mean centile of its notes) and the notes closest to the axis. |

The **Quality of the analysis** panel, under the tabs, tells how far the clusters can be trusted:

- **modularity**: how much more the notes resemble their own cluster than the others; below 0.3 the themes are weakly separated, above 0.5 they are clear;
- **silhouette**: whether each note is closer to its cluster than to the next one; text embeddings usually give low values, below 0.05 the clusters overlap a lot;
- **stability**: agreement between ten runs of the clustering with different seeds; a cluster below 60 % is marked unstable, its boundaries are uncertain;
- **hubness**: how much a few notes appear in everyone's neighbours, and its correction;
- **near duplicates**: pairs of notes almost identical in meaning; with a multilingual model a note and its translation appear here too;
- the **most isolated notes**, far from any other.

These thresholds are rules of thumb, not statistical tests. See [METRICS.md](METRICS.md) and the core's `docs/ANALYSIS.md` for the definitions.

## Settings

Under **Landscape** in the settings:

- **Cluster size**: the resolution of the clustering, 0.2 to 5 (1 by default); larger values give more, smaller clusters.
- **Date of a note**: last modification, creation, or a property (then give its name, for example `created`).
- **Interest axes**: a name and a few words for each theme you want to follow. Each axis is embedded by the same model as the notes, on this device.

## Names

Clusters are named by their most distinctive words (class-based TF-IDF on titles, headings, tags and text), without a language model. Words found in a quarter of the notes and in nearly every cluster (a title suffix, a template heading) are ignored.

A cluster keeps its identifier, colour and keyword name from one analysis to the next as long as it keeps most of its notes (at least 60 % in common).

A name given by hand is saved in the plugin's settings with the five most central notes of its cluster (its anchors), so it follows the vault on your other devices and survives clearing the data. After each analysis, it goes to the cluster that holds most of its anchors, and the anchors are updated. It is dropped when its anchors end up spread over several clusters (the theme split), or when two named clusters merge (the name with more anchors in the merged cluster stays).

## How it works

The analysis runs in a background worker, with the Semantic Atlas engine (WebAssembly):

1. graph of the 5 to 15 nearest neighbours of each note, corrected for hubs (local scaling);
2. Leiden clustering (modularity), consensus of ten runs, small clusters merged into their closest neighbour;
3. names, roles (core, connector, peripheral), centralities on the explicit links (PageRank, betweenness, core number, articulation points);
4. map layout with a force simulation of the semantic graph.

It takes about a second for 500 notes. The last analysis (clusters, names and positions) is kept in this device's index database, to keep identifiers and the map stable; it is deleted with the other data by **Clear all data of the plugin**.
