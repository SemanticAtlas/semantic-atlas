# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Weekly Dependabot updates for npm dependencies and GitHub Actions.

- Phase 0 specification (`docs/SPEC.md`): differences with the current Obsidian documentation, library choices, decisions, budgets, evaluation plan and risks.
- Project skeleton: reproducible esbuild build, official Obsidian ESLint rules, Vitest and fast-check tests, CI (lint, types, tests, build, size budget, reproducibility, llms.txt), release workflow with build provenance attestation, justfile.
- Versioned settings with migrations; settings saved by a newer release are used but never overwritten; reload on external change (sync).
- Debug mode setting: the console stays silent except for errors unless it is enabled.
- English and French interface, chosen from Obsidian's language.
- Semantic index (see `docs/SEMANTIC-INDEX.md`):
  - the embedding model is downloaded only after the user agreed (dialog with source, size and license; ranges; SHA-256 checked), or imported from files;
  - indexing runs in a background worker, incrementally by content hash, active note first, and can be paused;
  - vectors are kept in IndexedDB on the device;
  - commands: "Open related notes" (sidebar view with passages, drag to insert a link, hide already linked notes, copy as links, pause), "Search by meaning" (hybrid BM25 + vectors with rank fusion), "Open a random close note", "Pause indexing" / "Resume indexing", "Clear all data of the plugin";
  - index settings (version 2, migrated): title weight, passage length, excluded folders and tags, code blocks, mobile;
  - status bar progress;
  - tested in Obsidian 1.15.1 with 516 notes.
- Landscape view (command "Open the landscape", see `docs/LANDSCAPE.md`): map of the notes by cluster, cluster cards with renaming (a name given by hand follows the most central notes of its cluster, so it is kept across devices and after clearing the data), notes per cluster over time (year, quarter or month, by modification, creation or a date property), interest axes against clusters, and a "Quality of the analysis" panel (modularity, silhouette, stability, hubness, near duplicates, most isolated notes, with indicative thresholds). The analysis (Leiden clusters by consensus, names, roles, centralities, layout) runs in a background worker after indexing and keeps identifiers, names and positions from one run to the next; command "Update the analysis". Settings version 3 (migrated): cluster size, date source and property, interest axes, names given by hand. Tested in Obsidian 1.15.1 with 516 notes (analysis in under a second).
- Link graph view (commands "Open link graph" and "Open local link graph"): explicit links, embeds and front-matter links from the metadata cache. It is laid out by the Semantic Atlas engine (WebAssembly, embedded) and offers a local graph by depth, optional ghost notes for links to notes not created yet, an accessible table of links, keyboard navigation and theme colours. The view state is saved. See `docs/LINK-GRAPH.md`. Tested in Obsidian 1.15.1 (desktop, light and dark themes, plugin reload).
