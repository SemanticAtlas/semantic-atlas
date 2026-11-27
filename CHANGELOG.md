# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Phase 0 specification (`docs/SPEC.md`): differences with the current Obsidian documentation, library choices, decisions, budgets, evaluation plan and risks.
- Project skeleton: reproducible esbuild build, official Obsidian ESLint rules, Vitest and fast-check tests, CI (lint, types, tests, build, size budget, reproducibility, llms.txt), release workflow with build provenance attestation, justfile.
- Versioned settings with migrations; settings saved by a newer release are used but never overwritten; reload on external change (sync).
- Debug mode setting: the console stays silent except for errors unless it is enabled.
- English and French interface, chosen from Obsidian's language.
