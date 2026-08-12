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

### The command tree is noun-first

`b6p` is `b6p <subsystem> <verb>`. The **top level is a namespace of nouns**, one per platform
subsystem, and each noun owns its verbs: `b6p script push`, `b6p auth set`. This is the whole point of
the 0.5.0 restructure — the CLI is growing from a script-only tool into a general platform CLI, and a
top level occupied by verbs (`b6p push`) has nowhere to put `b6p forms pull`. **Do not add a top-level
verb.** If an operation doesn't belong to an existing noun, add a noun.

This mirrors core exactly. Script-tree operations do **not** hang off `B6PCore` itself; core groups them
on a `ScriptService` reached as `core.script` — `core.script.push(...)`, `core.script.pull(...)`, and so
on. Account-level operations (`updateCredentials`, `report`, `setConfig`, `checkForUpdates`) stay directly
on `core`. New core subsystems sit beside `script` rather than flattening onto the root object, and each
one earns a matching top-level noun here.

### Layout

| File | Owns |
|---|---|
| [src/index.ts](src/index.ts) | Version injection and `parseAsync` — nothing else |
| [src/program.ts](src/program.ts) | The root command and global flags; `buildProgram(version)` |
| [src/commands/index.ts](src/commands/index.ts) | `registerCommands(program)` — the list of subsystems |
| `src/commands/<noun>.ts` | One module per noun, exporting `register<Noun>Commands(program)` |
| [src/context.ts](src/context.ts) | `GlobalOpts`, SDK construction, and the `withCore` wrapper |
| [src/migrate.ts](src/migrate.ts) | One-shot legacy dotfile migration and dead-credential purge |

**Adding a subsystem** is: write `src/commands/<noun>.ts` with a `register<Noun>Commands`, add one line
to `registerCommands`. No existing command changes shape.

`buildProgram` is separate from `index.ts` so the tree can be constructed without running it —
[test/commandTree.test.ts](test/commandTree.test.ts) asserts the noun/verb shape that way.

### `withCore`

Every command action runs inside `withCore(globalOpts, async (ctx) => …)`. It builds the `B6PCore` over
the terminal providers, hands the action a `CliContext` (`core`, `prompt`, `spinner`, `globalOpts`,
`emitJson`), and — in a `finally` — stops the spinner and closes readline. That teardown is not optional:
skip it and the process hangs on an open stdin handle. Actions therefore contain no `try`/`finally` and
no provider construction. Use `ctx.emitJson(payload)` rather than testing `--json` by hand; it is a no-op
outside JSON mode.

### Deprecated top-level aliases

`b6p push|pull|audit|deploy|setup` remain as hidden aliases that warn on stderr, **scheduled for removal
in 0.6.0**. They are registered from the same registrar function as the `script` subcommands
([src/commands/script.ts](src/commands/script.ts)), so their flags cannot drift; a test asserts the two
stay definitionally identical. When they are removed, delete the alias loop — not the registrars.

### Authentication

The CLI supplies **no** `auth` provider, so core defaults to its `BearerAuthProvider`: a single opaque
token in secret storage under the key `bearerAuth`. All prompting and storage happen in core — the CLI
neither reads nor writes the token. Two consequences worth knowing:

- The removed basic-auth scheme stored under a *different* key (`basicAuth`), so an upgraded install is
  re-prompted automatically. Core only purges that dead key during `b6p auth clear`, so
  `purgeLegacyBasicAuth` in [src/migrate.ts](src/migrate.ts) does it on every run. It must stay ordered
  **after** `migrateLegacyDotfiles`, which seeds secrets from the legacy plaintext `~/.b6p/secrets.json`
  and would otherwise re-import the pair being retired.
- Core treats the token as opaque and has no `b6pt_` constant. Naming that format is therefore the
  terminal's job, and `b6p auth set` does it. Do not teach core the prefix just to phrase a prompt.

### Providers

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
([src/context.ts](src/context.ts)): a **`WindowsRestartManagerLockDiagnoser`** ([src/lockDiagnoser/](src/lockDiagnoser/)),
implementing the core's `LockDiagnoser`. When a shared-state `rename` fails on Windows, core calls it to
name the user-mode processes holding the file (via the Windows Restart Manager, queried from a bundled
PowerShell script) so the thrown error is actionable. It is best-effort — never throws, and returns no
holders off Windows or when only a kernel filesystem minifilter (AV/ransomware protection) is involved,
which core turns into its minifilter hint.

## TypeScript & Build Configuration

- **Target/module**: ES2022 / Node16, `strict` mode. Base options in `tsconfig.base.json`, package
  overrides in `tsconfig.json` (`noEmit: true` — esbuild produces the artifact, not `tsc`).
- **Two TypeScripts, on purpose.** This package type-checks with TypeScript 7 (`devDependencies`), while
  `b6p-core` transpiles pushes with an exact-pinned TypeScript 5.9.2 in its own `dependencies`. npm
  cannot dedupe them, so a nested `node_modules/@bluestep-systems/b6p-core/node_modules/typescript`
  is expected — that nested copy is what esbuild bundles into `dist/cli.js`. Consequently
  [esbuild.js](esbuild.js)'s `copy-ts-libs` resolves `typescript` **from core's directory**, never from
  the repo root: the shipped `dist/lib/lib.*.d.ts` must match the compiler that reads them. TS 7 ships
  no `lib.*.d.ts` at all (the Go port embeds them), so a root-resolved copy would fail the build.
- **`types: ["node"]`** is set explicitly in `tsconfig.json`. TypeScript 7 no longer pulls every
  `node_modules/@types` package into global scope, so `process`, `__dirname` and the `node:` builtins
  must be requested by name.
- **No linter.** ESLint and `typescript-eslint` were removed: `typescript-eslint` peer-caps TypeScript
  at `<6.1.0`, which is incompatible with TS 7. `npm run check-types` and `npm run format-check` are the
  static gates. Restore linting once `typescript-eslint` supports TS 7.
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
