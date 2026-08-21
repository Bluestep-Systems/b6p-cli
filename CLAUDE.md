# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

This is a **single-package CLI**: `@bluestep-systems/b6p-cli`, published to the public npm registry and
installed globally as the `b6p` binary (`npm i -g @bluestep-systems/b6p-cli`). It is a thin front-end
over [`@bluestep-systems/b6p-core`](https://github.com/Bluestep-Systems/b6p-core) — the vscode-free core
shared with the VS Code extension ([`vscode-extension`](https://github.com/Bluestep-Systems/vscode-extension)).

`b6p-core` is a **`devDependency`**, not a runtime dependency: esbuild bundles it (and `commander`,
`fast-xml-parser`, …) into a single self-contained `dist/cli.js`. Only Node builtins stay external. This
coupling is documented in [esbuild.js](esbuild.js) — if you externalize a package there, move it back to
`dependencies` or `npm install` of the published CLI will break.

## Common Development Commands

```bash
npm run compile       # Bundle → dist/cli.js (esbuild, production)
npm run build:sea     # Standalone binary for the current OS (Node SEA; see docs/adr/0001)
npm run watch         # Rebuild on change (esbuild --watch)
npm run check-types   # Type-check only (tsc --noEmit)
npm run format        # Prettier --write (config in .prettierrc)
npm run format-check  # Prettier --check
npm run test          # Bundle test/**/*.test.ts → dist-test/ (esbuild.test.js) and run node --test
npm run clean         # rm -rf dist dist-test
```

Smoke-test the built binary with `node dist/cli.js --help` (CI runs this after every compile).

Tests are authored in TS under [test/](test/) and compiled to `dist-test/` by [esbuild.test.js](esbuild.test.js)
rather than run through a `.ts` loader, so they execute on the whole CI Node matrix (18/20/22) with no
type-stripping. `dist-test/` is gitignored. CI runs `npm test` between compile and the smoke run.

## Architecture Overview

The entry point is [src/index.ts](src/index.ts): it defines the [commander](https://github.com/tj/commander.js)
command tree (`pull`, `push`, `audit`, `deploy`, `setup`, `report`, `auth`, `sessions`, `config`,
`check-updates`), parses argv, constructs a `B6PCore` from `@bluestep-systems/b6p-core`, and dispatches.

Script-tree operations do **not** hang off `B6PCore` itself. Core groups them on a `ScriptService`
reached as `core.script` — `core.script.push(...)`, `core.script.pull(...)`, `core.script.audit(...)`,
`core.script.deploy(...)`, `core.script.getSetupUrl(...)`. Account-level operations (`updateCredentials`,
`report`, `setConfig`, `checkForUpdates`) stay directly on `core`. New platform subsystems are expected
to sit beside `script` rather than flatten onto the root object.

All platform behaviour the core needs is supplied through Node implementations of the core's provider
interfaces, under [src/providers/](src/providers/):

- **NodeFileSystem** — `FileSystem` over `node:fs`.
- **CliPrompt** — `Prompt` via `readline` (honors `--yes` for non-interactive use).
- **CliLogger** — `Logger` to stderr (honors `--verbose`).
- **CliProgress** / **Spinner** — `Progress` + a TTY spinner (suppressed in `--json` / `--quiet`).
- **DotfilePersistence** — legacy dotfile migration into the core's `SharedFilePersistence`.

Durable state (credentials, sessions, settings) is handled by the core's `SharedFilePersistence`, not by
the CLI. The CLI only adapts I/O, prompting, logging, and progress to a terminal.

One further platform-specific dependency is injected into `SharedFilePersistence` at construction
([src/index.ts](src/index.ts)): a **`WindowsRestartManagerLockDiagnoser`** ([src/lockDiagnoser/](src/lockDiagnoser/)),
implementing the core's `LockDiagnoser`. When a shared-state `rename` fails on Windows, core calls it to
name the user-mode processes holding the file (via the Windows Restart Manager, queried from a bundled
PowerShell script) so the thrown error is actionable. It is best-effort — never throws, and returns no
holders off Windows or when only a kernel filesystem minifilter (AV/ransomware protection) is involved,
which core turns into its minifilter hint.

## TypeScript & Build Configuration

- **Target/module**: ES2022 / Node16, `strict` mode. Base options in `tsconfig.base.json`, package
  overrides in `tsconfig.json` (`noEmit: true` — esbuild produces the artifact, not `tsc`).
- **One TypeScript, exact-pinned at 5.9.2 — matching the one core bundles.** This package pins
  `typescript` to exactly `5.9.2`, the same exact version `b6p-core` declares as a runtime
  `dependency` for transpiling pushes, so npm dedupes to a single copy and there is no nested
  `node_modules/@bluestep-systems/b6p-core/node_modules/typescript`. Do not float this to a range or a
  newer major without reading
  [docs/adr/0002-typescript-version-strategy.md](docs/adr/0002-typescript-version-strategy.md):
  TypeScript 7 cannot compile in-process (no `createProgram`/`transpileModule`; its replacement drives
  a per-platform native binary over JSON-RPC) and ships no `lib.*.d.ts` at all, which is incompatible
  with both `ScriptTranspiler` and this package's single-bundle + SEA distribution.
- **`copy-ts-libs` resolves `typescript` from core's directory, never the repo root.** The shipped
  `dist/lib/lib.*.d.ts` are read **at runtime** by the compiler esbuild inlined into `dist/cli.js`, so
  they must match *that* compiler. It happens to be the same 5.9.2 the root has while the pins agree —
  and resolving from core is what keeps it correct if they ever diverge. Note the failure mode is
  **silent** on 5.x (a root-resolved lookup finds *some* libs and ships them); the lib-set invariant
  test is what makes a mismatch red instead of a broken `push --snapshot` in the field.
- **`types: ["node"]`** is set explicitly in `tsconfig.base.json`. It was required by TS 7 (which no
  longer pulls every `node_modules/@types` package into global scope) and is kept deliberately: on 5.9
  it is simply a narrower, explicit global scope, and it is one less thing to redo if this package ever
  moves forward again.
- **No linter, for now.** ESLint and `typescript-eslint` were removed when this package moved to TS 7,
  because `typescript-eslint` peer-caps TypeScript at `<6.1.0`. The rollback to 5.9.2 makes that peer
  satisfiable again, so restoring it is now possible — an explicitly deferred decision, not a
  constraint. Until then `npm run check-types` and `npm run format-check` are the static gates, and the
  **no-`any` rule is documentation only**: an explicit `any` compiles silently (`noImplicitAny` still
  catches the implicit case), so enforce it by reading the diff.
- **Output**: `dist/cli.js`, a single CJS bundle with a `#!/usr/bin/env node` banner and `0755` mode, so
  it runs directly as the `b6p` bin.

## Distribution

Two artifacts are built from the **same** `dist/cli.js` bundle:

- **npm package** (`@bluestep-systems/b6p-cli`) — the primary distribution; published by
  [.github/workflows/publish.yml](.github/workflows/publish.yml) on a version tag. Binary work must
  **not** change it — leave `publish.yml`, the `bin` mapping, and the `files`/`dependencies` lists alone.
- **Standalone binaries** — self-contained, Node-bundling `b6p` executables for Windows/macOS, for
  machines with no Node/npm. Built by [scripts/build-sea.mjs](scripts/build-sea.mjs) (Node SEA +
  `postject`, run via `npm run build:sea`) and attached to each GitHub Release by
  [.github/workflows/release.yml](.github/workflows/release.yml) when a Release is published. SEA embeds
  the **real Node runtime**, so runtime-sensitive provider code — notably the raw-mode TTY masking in
  `CliPrompt` — behaves exactly as on the npm path. SEA can't cross-compile, so CI builds one binary per
  OS/arch runner (`b6p-windows-x64.exe`, `b6p-macos-x64`, `b6p-macos-arm64`). Rationale and rejected
  alternatives: [docs/adr/0001-standalone-binary-toolchain.md](docs/adr/0001-standalone-binary-toolchain.md).

## Important Development Guidelines

- **Never use the `any` type.** If it seems unavoidable, leave a `//HUMAN-REVIEW-NEEDED` comment
  explaining why instead.
- **Keep types accurate** — update signatures when behaviour changes; do not rely on implied types.
- **Cross-package code goes through `@bluestep-systems/b6p-core`**, never relative paths into the core
  source. Shared logic belongs in core, not duplicated here.
- **Number formatting**: use underscores for thousands separators (`1_000`, `10_000_000`).
- **Formatting**: Prettier (120 print width, 2-space, semicolons, `trailingComma: es5`).

## Additional Instructions

Defer to [AGENTS.md](AGENTS.md) for AI agent usage and documentation-sync rules. If there are any
discrepancies, AGENTS.md is authoritative.
