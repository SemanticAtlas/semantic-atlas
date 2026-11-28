# Dependency maintenance

Dependabot checks npm dependencies and GitHub Actions workflow references weekly using `.github/dependabot.yml`. It proposes updates as pull requests; review the changes and run CI before merging. The core and engine are pinned to GitHub distribution tags, so check their releases and compatibility when updating those dependencies.
