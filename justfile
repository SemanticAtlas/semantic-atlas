# Semantic Atlas: main entry points. Run `just` to list them.

default:
    @just --list

# Install the pinned development dependencies
install:
    npm ci

# Rebuild main.js on every change (development build, inline source map)
dev:
    npm run dev

# Production build: type check, then bundle main.js
build:
    npm run build

# Type check without emitting
typecheck:
    npm run typecheck

# Lint with the official Obsidian rules (zero errors required)
lint:
    npm run lint

# Unit and property tests
test:
    npm test

# Check the main.js size budget
size: build
    npm run check:size

# Check that two builds give the same main.js
reproducible:
    npm run check:reproducible

# Regenerate llms.txt and llms-full.txt from the documentation
docs:
    npm run docs:llms

# Everything CI runs, in order; run it before committing
check: lint typecheck test build size reproducible docs

# Bump the version (patch, minor or major) in package.json, manifest.json and versions.json
bump level:
    npm version {{level}} --no-git-tag-version
    node version-bump.mjs
