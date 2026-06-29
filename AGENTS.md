# AI Agent Guidelines

## Overview

This repository is the **single-package CLI** `@bluestep-systems/b6p-cli` — the `b6p` command-line tool,
a thin front-end over [`@bluestep-systems/b6p-core`](https://github.com/Bluestep-Systems/b6p-core) (the
vscode-free core, shared with the [`vscode-extension`](https://github.com/Bluestep-Systems/vscode-extension)
extension). The entry point is [src/index.ts](src/index.ts); terminal adapters for the core's provider
interfaces live in [src/providers/](src/providers/).

Hard constraints for this repo:

- **Cross-package code goes through `@bluestep-systems/b6p-core`** — never relative paths into the core
  source. Shared orchestration logic belongs in core; this repo only adapts it to a terminal. `b6p-core`
  is a bundled `devDependency` (esbuild inlines it into `dist/cli.js`); see [esbuild.js](esbuild.js).
- **Never use `any`.** If it appears unavoidable, leave a `//HUMAN-REVIEW-NEEDED` comment explaining the
  situation. If a human reviewer later accepts `any`, they add a `//REASON-FOR-ANY` comment.
- **The npm artifact must stay unchanged by binary work.** A standalone-binary pipeline
  ([scripts/build-sea.mjs](scripts/build-sea.mjs) → [.github/workflows/release.yml](.github/workflows/release.yml))
  ships Node-bundling `b6p` executables on GitHub Releases, built from the same `dist/cli.js`. Never alter
  `publish.yml`, the `bin` mapping, or `package.json` `files`/`dependencies` to accommodate it. Rationale:
  [docs/adr/0001-standalone-binary-toolchain.md](docs/adr/0001-standalone-binary-toolchain.md).

## Required Documentation Updates

When you change code, keep the docs in sync in the **same change**:

| File | Purpose | Update when |
|------|---------|-------------|
| `README.md` | User-facing docs (install, commands) | Commands, flags, install, or usage change |
| `CLAUDE.md` | Developer/agent guide | Architecture, providers, or workflow changes |
| `AGENTS.md` | AI agent rules (this file) | Conventions or process changes |
| `CHANGELOG.md` | Version history | Any user-visible change, fix, or breaking change |

**Never leave documentation outdated** — it is worse than no documentation. If uncertain, leave a
`//HUMAN-REVIEW-NEEDED` note.

## Documentation Quality Standards

- **Be specific**: include file paths, command names, and flags.
- **Be actionable**: provide concrete examples.
- **Be current**: remove outdated information when you change behaviour.
- **Be consistent**: use the same terminology across all docs.

## JSDoc Review Requirement

All AI-generated or AI-modified JSDoc **MUST** include the `@lastreviewed null` flag. A human reviewer
replaces `null` with the review date after verifying accuracy.

```typescript
/**
 * Processes user input and validates the data.
 * @param input The user input to process
 * @returns Processed and validated data
 * @lastreviewed null
 */
function processInput(input: string): ProcessedData {
  // implementation
}
```

## Type Maintenance

Whenever making code changes, ensure all TypeScript types are accurate and up to date:

- Ensure function signatures are correct **and not implied**.
- Verify type imports reflect the current codebase.
- Types shared with the extension belong in `@bluestep-systems/b6p-core`, not here.

## Number Formatting

Use underscores for thousands separators in numeric literals (e.g. `1_000`, `10_000_000`).

## Formatting

Prettier governs style (see `.prettierrc`): 120 print width, 2-space tabs, semicolons,
`trailingComma: es5`. Run `npm run format` before committing.

## Overriding Guidelines

In exceptional cases where a guideline is impractical, you may override it — but document the override
with a `//HUMAN-REVIEW-NEEDED` comment explaining the reason and what a human must review.
