# Changelog

All notable changes to `@bluestep-systems/b6p-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] — 2026-08-21

### Changed

- **Rolled back the TypeScript 7 type-checker: `typescript` is now pinned to exactly `5.9.2`, the
  same version `b6p-core` bundles to transpile pushes.** No CLI behaviour changes — no command, flag,
  argument or output is affected. The source did not change either; it type-checks clean on 5.9.2,
  6.0.0-beta and 7.0.2 alike, so this is a toolchain change only.

  **Why.** `b6p-core` compiles TypeScript *at runtime* — `b6p push --snapshot` transpiles a
  component's `draft/scripts/*.ts` in-process — and TypeScript 7 cannot do that. Its `typescript`
  entry point is only a version stub, the classic API (`createProgram`, `transpileModule`) is gone,
  and its replacement drives a per-platform native Go binary over JSON-RPC, which cannot be inlined
  into this package's single `dist/cli.js` or embedded in its Node SEA binaries. TypeScript 7 also
  ships no `lib.*.d.ts` at all, while the transpiler needs real lib files on disk.

  Type-checking with 7 while core compiled with 5.9 therefore meant two TypeScripts permanently, an
  un-dedupable nested copy under `node_modules/@bluestep-systems/b6p-core/`, and a lib-copying step
  that had to resolve the compiler from core's directory to stay correct. Pinning both to the same
  exact version collapses all of that: npm now dedupes to one copy, and `dist/lib/` carries 99
  `lib.*.d.ts` matching the 5.9.2 the bundle embeds.

  The decision, the alternatives (including why not the 6.0 beta — there is no stable 6.x) and the
  condition for moving forward again are recorded in
  [docs/adr/0002-typescript-version-strategy.md](docs/adr/0002-typescript-version-strategy.md).

  The scaffolding from the TS 7 migration is **kept on purpose**: `types: ["node"]`, `copy-ts-libs`
  resolving from core's directory, and the lib-set invariant test all stay. They cost nothing on 5.9
  and are what a future upgrade needs.

### Added

- ADR 0002 documenting the TypeScript version strategy and the trigger to revisit it.

## [0.6.0] — 2026-08-21

### Changed (breaking, user-visible)

- **Authentication now uses an access token instead of a username and password.** This comes from
  `b6p-core` 0.5.0 replacing basic auth with bearer auth, and **there is no migration path by
  construction** — a token cannot be derived from a stored username and password. On first use
  after upgrading you will be asked for an access token; run `b6p auth set` to store one up front.
  `b6p auth clear` also purges the obsolete stored credentials.

### Fixed

- **A prompt that cannot be answered no longer exits `0` having done nothing.** `readline`'s
  `question()` promise never settles once stdin has ended, so the event loop drained and the process
  exited **successfully** from a command that did nothing. Combined with the auth change above, the
  first non-interactive run after upgrading would have printed `Enter your access token:` and exited
  `0` without pulling anything. `CliPrompt` now detects end-of-input and fails with an actionable
  message (exit `1`), and remembers that stdin is spent so a later prompt reports the same thing
  rather than readline's internal `readline was closed`. That second half is
  [ClickUp 86bb8f6v0](https://app.clickup.com/t/86bb8f6v0): a push reaching a *second* "upstairs file
  changed" prompt with one piped answer died on that internal error mid-push.

  An answer that *is* available always wins: piped input ends in the same turn its bytes arrive, so
  the end-of-input check is deferred one macrotask — `echo Sync | b6p ...` still works. Covered by
  `test/CliPrompt.test.ts`, whose cases fail (hang, then time out) against the old implementation.

The rest come from bumping `@bluestep-systems/b6p-core` `^0.5.0` → `^0.6.0`, which carries two
fixes reported through the feedback pipeline plus a safety change. All three are core-side
behaviour changes; the CLI's role is to surface them.

- **`b6p pull` no longer overwrites a locally-edited file it has previously synced** (ClickUp
  86bbdr4r0). A file whose content differs from both the platform copy and the last-synced hash is
  kept, and every kept file is listed in one warning at the end of the pull. Downloads are also
  atomic now, so an interrupted pull can no longer leave a truncated file behind — and the ETag
  integrity check runs before the write rather than after it.
- **`b6p push --snapshot` no longer prints "Snapshot complete!" when the snapshot history was not
  recorded** (ClickUp 86bbed9wu). The history mutation is retried when the platform rejects it with
  the post-upload "version mismatch" (which is what made the *second* consecutive snapshot push to a
  component lose its restore point); if it still fails, the push says so explicitly.
- **`b6p audit --pull` no longer authorizes overwrites non-interactively.** Its "Sync?" confirmation
  now defaults to *Cancel*, so `--yes` declines rather than overwriting locally-edited files, and a
  real confirmation only force-overwrites the files it actually listed. To take the platform copy
  non-interactively, delete the file and pull.

### Added

- **`--json` output for `push` and `pull`,** and a non-zero exit code for a push that did not do what
  was asked. `push` emits core's `PushResult` (`{ pushed, historyRecorded }`) and exits `1` when
  `pushed` is false (bad `--root`, empty draft — previously a typo could mark a CI deploy green) or
  when a snapshot shipped without its history entry. `pull` emits `PullResult`
  (`{ keptLocalPaths }`), which is reporting only: keeping a locally-edited file is the guard working
  as designed, so it stays exit `0` rather than failing every pull in a tree with local edits.

## [0.5.0] — 2026-08-12

### Changed

- **Breaking (internal API only — no user-visible CLI change).** Bumped `@bluestep-systems/b6p-core`
  `^0.4.0` → `^0.5.0` and migrated to its reshaped surface. Every command, flag, argument, and output
  format is unchanged; this release is a re-addressing of the same operations.
  - Script-tree operations moved off `B6PCore` onto a `ScriptService` reached as `core.script`:
    `push`, `pushCurrent`, `pull`, `pullCurrent`, `audit`, `auditPull`, `deploy`, `deriveWorkspacePath`
    and `getSetupUrl` are now `core.script.*`. Signatures are byte-identical. Account-level operations
    (`updateCredentials`, `report`, `setConfig`, `checkForUpdates`) stay on `core`.
  - Core's provider interfaces dropped their Hungarian `I` prefix: `IFileSystem` → `FileSystem`,
    `IPersistence` → `Persistence`, `IPrompt` → `Prompt`, `ILogger` → `Logger`, `IProgress` → `Progress`,
    `ILockDiagnoser` → `LockDiagnoser`. The five providers in [src/providers/](src/providers/) and
    `WindowsRestartManagerLockDiagnoser` were updated to match.
- Upgraded the type-checker to **TypeScript 7** (`^5.9.2` → `^7.0.2`), and set `types: ["node"]`
  explicitly in `tsconfig.json` — TS 7 no longer pulls every `node_modules/@types` package into global
  scope, so `process`, `__dirname` and the `node:` builtins must be requested by name.
- Bumped `prettier` → `^3.9.6` and `@types/node` → `^22.20.1`.

### Fixed

- `esbuild.js`'s `copy-ts-libs` plugin now resolves `typescript` **from b6p-core's directory** instead of
  the repo root, so the `lib.*.d.ts` shipped to `dist/lib/` always match the compiler that reads them.
  Core pins `typescript` at exactly `5.9.2` as a runtime dependency (its `ScriptTranspiler` compiles
  snapshot pushes) and npm cannot dedupe that against this package's TS 7, so the bundled compiler and
  the root `tsc` are deliberately different majors. Without this change the TypeScript 7 upgrade would
  have broken the build outright: TS 7 ships **no** `lib.*.d.ts` files at all (the Go port embeds them),
  so the old root-resolved lookup would have found zero libs and thrown `copy-ts-libs: no lib.*.d.ts
  found`. `scripts/build-sea.mjs` reads `dist/lib/` and inherits the fix.

### Removed

- **ESLint and `typescript-eslint`**, along with `eslint.config.mjs`, the `npm run lint` script, and the
  lint steps in [ci.yml](.github/workflows/ci.yml) / [publish.yml](.github/workflows/publish.yml).
  `typescript-eslint` 8.67 (current stable) declares `typescript: ">=4.8.4 <6.1.0"`, so it cannot run
  against TypeScript 7. `npm run check-types`, `npm run format-check` and `npm test` are now the static
  gates. Note that the project's no-`any` rule is consequently no longer machine-enforced — see
  [AGENTS.md](AGENTS.md). Linting should be restored when `typescript-eslint` supports TS 7.

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
