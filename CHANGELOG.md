# Changelog

All notable changes to `@bluestep-systems/b6p-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] — 2026-07-23

### Added

- Windows lock diagnostics on shared-state writes. When a write to `~/.b6p/state.json` or
  `secrets.enc` fails a `rename` on Windows after core's bounded retries, the thrown error now names
  the user-mode processes holding the file — e.g. `… — locked by Code.exe (1234), OneDrive.exe (5678)`
  — so you can close the offending program and retry. Implemented by a new
  `WindowsRestartManagerLockDiagnoser` (`src/lockDiagnoser/`) that queries the Windows Restart
  Manager via a bundled PowerShell script and is injected into the core's `SharedFilePersistence`.
  Best-effort and a no-op off Windows: it never throws and returns no holders when it can't determine
  them. A kernel filesystem minifilter (real-time AV / ransomware protection such as Sophos
  CryptoGuard) holds no user-mode handle, so it is invisible to this probe by design — in that case
  the empty result degrades to core's minifilter hint rather than a process list.

### Changed

- Bumped `@bluestep-systems/b6p-core` `^0.3.1` → `^0.4.0`, which adds the injectable `ILockDiagnoser`
  the diagnoser above plugs into, plus Windows `rename` lock-error retries and pull write coalescing
  ([core #8](https://github.com/Bluestep-Systems/b6p-core/issues/8)).

### Internal

- Added a unit-test setup: `npm test` bundles `test/**/*.test.ts` to `dist-test/` via `esbuild.test.js`
  and runs them with `node --test` (runnable on the whole CI Node 18/20/22 matrix). CI now runs the
  tests between compile and the smoke run.

## [0.3.1] — 2026-07-21

### Changed

- Bumped `@bluestep-systems/b6p-core` to `^0.3.1`. Because core is esbuild-bundled into `dist/cli.js`,
  this dependency bump is what ships the release's changes — there are no CLI source changes. Core
  0.3.1 fixes two `b6p push` bugs for freshly-pulled MergeReport components that ship a `static/`
  bundle ([#9](https://github.com/Bluestep-Systems/b6p-cli/issues/9)): `push` no longer aborts when a
  `static/` sub-project's `tsconfig.json` has an empty/missing `outDir` (normalized to `.build`), and
  `push` now emits a loud warning when a client bundle's source `.ts`/`.tsx` is newer than its compiled
  `.js` (the platform serves `static/.build/script.js` verbatim, so editing only the source would
  otherwise silently ship stale client JS). All changes are additive and backward-compatible; commands,
  flags, and runtime behavior are unchanged.

## [0.3.0] — 2026-07-10

### Changed

- Bumped `@bluestep-systems/b6p-core` to `^0.3.0`. Because core is esbuild-bundled into `dist/cli.js`,
  this dependency bump is what ships the release's changes — there are no CLI source changes. Core
  0.3.0 adds internal `whenReady()` async-load race guards in the persistence store/map (awaited inside
  `B6PCore`/`ScriptRoot`) and the new `ScriptFile.currentIntegrityStatus()` helper. All changes are
  additive and backward-compatible; commands, flags, and runtime behavior are unchanged.

## [0.2.1] — 2026-07-07

### Fixed

- `b6p push` no longer fails its pre-flight TypeScript compile with `File 'lib.esnext.d.ts' not found`
  (cascading into `Cannot find global type 'Array'`) in the bundled npm CLI and the standalone
  binaries. TypeScript's default host resolves its standard library relative to `__filename`, which
  once bundled points inside the bundle where no `lib.*.d.ts` exist. The CLI now ships the full
  TypeScript lib set — copied next to the npm bundle and embedded in (then extracted from) the SEA
  binary — and hands it to the core via `providers.typescriptLibDirs`.
  ([#4](https://github.com/Bluestep-Systems/b6p-cli/issues/4))

### Changed

- Bumped `@bluestep-systems/b6p-core` to `^0.2.0`, which adds the `typescriptLibDirs` provider and the
  `TsLibResolver` that consumes it.

## [0.2.0] — 2026-06-29

### Added

- **Standalone binaries.** Each GitHub Release now ships self-contained, Node-bundling `b6p`
  executables for Windows (x64) and macOS (x64 + arm64), built in CI via Node SEA and attached to
  the Release (`b6p-windows-x64.exe`, `b6p-macos-x64`, `b6p-macos-arm64`, each with a `.sha256`
  checksum sidecar). They run the full CLI on machines with **no Node or npm installed** — download
  one file, put it on `PATH`, and `b6p <command>` works. The npm package
  (`npm i -g @bluestep-systems/b6p-cli`) is **unchanged** and remains the primary distribution. See
  [the toolchain ADR](docs/adr/0001-standalone-binary-toolchain.md).

### Fixed

- `b6p --version` now reports the actual package version instead of a hardcoded `0.0.1`. The version
  is injected at build time via an esbuild `define` (`__B6P_VERSION__`), so it stays correct in both
  the npm bundle and the standalone binary — neither of which can read `package.json` at runtime.

## [0.1.1] — 2026-06-24

### Fixed

- Password prompts now mask typed input (echoed as `*`) instead of displaying it in
  plaintext. `CliPrompt.inputBox()` previously ignored its `password` flag, leaking
  credentials entered during `b6p auth` to the terminal and scrollback. Masking uses
  raw-mode stdin on a TTY and falls back to the standard read for piped/non-TTY input.
  ([#1](https://github.com/Bluestep-Systems/b6p-cli/issues/1))

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
