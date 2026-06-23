# Changelog

All notable changes to `@bluestep-systems/b6p-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-23

Initial standalone release of the `b6p` CLI, extracted (with history) from the former
`bsjs-push-pull` monorepo into its own repository and published to the public npm registry.
Shares its core (`@bluestep-systems/b6p-core`) with the VS Code extension.

### Added

- `b6p pull` — pull a script by WebDAV URL or via local file metadata.
- `b6p push` — push local files back to the platform, with optional
  `--snapshot --message "…"` to record versioned history.
- `b6p audit` — diff local vs. server, with `--pull` to sync when differences are found.
- `b6p deploy` — multi-target deploy driven by a config file.
- `b6p setup` — emit the web-UI setup URL for a script.
- `b6p report` — report cached state.
- `--json` and `--yes` flags across commands for non-interactive use.

### Fixed

- Guard against wrong-directory writes when pulling scripts whose names collide
  across modules.

### Changed

- Distribution is the **public npm registry** (`registry.npmjs.org`, public access). Install with
  `npm i -g @bluestep-systems/b6p-cli` — no authentication required. The `@bluestep-systems/b6p-core`
  dependency is resolved from public npm by version (bundled at build time) rather than a monorepo
  workspace symlink. (Supersedes the in-monorepo GitHub Packages configuration.)
- Extracted into its own standalone repository with self-contained `tsconfig`/eslint/prettier config and
  per-repo CI (validation) and publish (tag-triggered, provenance) GitHub Actions workflows. No change to
  commands, flags, or runtime behavior.
- Snapshot creation is part of the unified push flow rather than a separate step.
