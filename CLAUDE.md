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
npm run watch         # Rebuild on change (esbuild --watch)
npm run check-types   # Type-check only (tsc --noEmit)
npm run lint          # ESLint
npm run format        # Prettier --write (config in .prettierrc)
npm run format-check  # Prettier --check
npm run clean         # rm -rf dist
```

Smoke-test the built binary with `node dist/cli.js --help` (CI runs this after every compile).

## Architecture Overview

The entry point is [src/index.ts](src/index.ts): it defines the [commander](https://github.com/tj/commander.js)
command tree (`pull`, `push`, `audit`, `deploy`, `setup`, `report`, `auth`, `sessions`, `config`,
`check-updates`), parses argv, constructs a `B6PCore` from `@bluestep-systems/b6p-core`, and dispatches.

All platform behaviour the core needs is supplied through Node implementations of the core's provider
interfaces, under [src/providers/](src/providers/):

- **NodeFileSystem** — `IFileSystem` over `node:fs`.
- **CliPrompt** — `IPrompt` via `readline` (honors `--yes` for non-interactive use).
- **CliLogger** — `ILogger` to stderr (honors `--verbose`).
- **CliProgress** / **Spinner** — `IProgress` + a TTY spinner (suppressed in `--json` / `--quiet`).
- **DotfilePersistence** — legacy dotfile migration into the core's `SharedFilePersistence`.

Durable state (credentials, sessions, settings) is handled by the core's `SharedFilePersistence`, not by
the CLI. The CLI only adapts I/O, prompting, logging, and progress to a terminal.

## TypeScript & Build Configuration

- **Target/module**: ES2022 / Node16, `strict` mode. Base options in `tsconfig.base.json`, package
  overrides in `tsconfig.json` (`noEmit: true` — esbuild produces the artifact, not `tsc`).
- **Output**: `dist/cli.js`, a single CJS bundle with a `#!/usr/bin/env node` banner and `0755` mode, so
  it runs directly as the `b6p` bin.

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
