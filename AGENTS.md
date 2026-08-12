# AI Agent Guidelines

## Overview

This repository is the **single-package CLI** `@bluestep-systems/b6p-cli` — the `b6p` command-line tool,
a thin front-end over [`@bluestep-systems/b6p-core`](https://github.com/Bluestep-Systems/b6p-core) (the
vscode-free core, shared with the [`vscode-extension`](https://github.com/Bluestep-Systems/vscode-extension)
extension). The entry point is [src/index.ts](src/index.ts); terminal adapters for the core's provider
interfaces live in [src/providers/](src/providers/).

Hard constraints for this repo:

- **The command tree is noun-first: `b6p <subsystem> <verb>`.** The top level is a namespace of platform
  subsystems (`script`, `auth`, `sessions`, `config`), each owning its verbs. **Never add a top-level
  verb** — that slot is reserved for subsystems, and reintroducing `b6p <verb>` re-creates exactly the
  collision the 0.5.0 restructure removed. Add a command by writing `src/commands/<noun>.ts` exporting
  `register<Noun>Commands(program)` and adding one line to `registerCommands` in
  [src/commands/index.ts](src/commands/index.ts). The hidden `push`/`pull`/`audit`/`deploy`/`setup`
  aliases are a deprecation shim removed in 0.6.0; do not add more, and do not hand-edit one half of a
  pair — both come from a single registrar so they cannot drift.
- **Command actions run inside `withCore`** ([src/context.ts](src/context.ts)). It owns SDK construction
  and the `finally` that stops the spinner and closes readline; an action that builds its own providers
  or skips that teardown leaks an stdin handle and hangs the process. Emit machine-readable output with
  `ctx.emitJson(...)`, not a hand-rolled `--json` check.
- **A command that fails must exit non-zero.** Core reports most failures through `Prompt.error` /
  `Logger.error` and returns normally instead of throwing, so a `FailureTracker` ([src/exit.ts](src/exit.ts))
  counts those channels and `withCore` turns the count into exit `1`. When adding a command: report a
  genuine failure through `prompt.error` (never `warn`, which does not count), and report a *negative
  answer* through `prompt.info` — `b6p auth status` with no token stored is a success. Never make the
  exit code depend on `--json` / `--quiet` / `--verbose`, and prefer `process.exitCode` to
  `process.exit()`, which can truncate an in-flight stdout write.
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

## Static Checks

There is **no linter**. ESLint and `typescript-eslint` were removed when this package moved to
TypeScript 7 (`typescript-eslint` peer-caps TypeScript at `<6.1.0`). The remaining gates are:

```bash
npm run check-types   # tsc --noEmit — the only semantic gate
npm run format-check  # prettier --check
npm test              # node --test over dist-test/
```

This matters for the **no-`any`** rule above: it used to be backstopped by
`@typescript-eslint/no-explicit-any`, and now it is not. An explicit `any` will compile silently. Enforce
it by reading the diff, not by trusting the build. `noImplicitAny` in `tsconfig.base.json` still catches
the *implicit* case.

## Number Formatting

Use underscores for thousands separators in numeric literals (e.g. `1_000`, `10_000_000`).

## Formatting

Prettier governs style (see `.prettierrc`): 120 print width, 2-space tabs, semicolons,
`trailingComma: es5`. Run `npm run format` before committing.

## Branch, Commit, PR, and ClickUp Conventions

Substantive work is tracked by a ClickUp task; feedback-pipeline reports and their tracking tasks live
in the **AI.List** list. Follow these so ClickUp's GitHub integration can auto-link the work:

- **Branches** carry the ClickUp task id with the `CU-` prefix: `CU-<taskid>`, or
  `<type>/<slug>-CU-<taskid>` when a descriptive slug helps. The `CU-` spelling is what ClickUp's
  GitHub integration matches — a bare id or another prefix does not auto-link.
- **Commits** use conventional-commit style (`fix(scope):`, `feat:`, `test:`, `refactor:`, `chore:`,
  `docs:`, `release: vX.Y.Z — summary`) and reference the ClickUp task as `(CU-<taskid>)`. AI-authored
  commits end with their agent's `Co-Authored-By` trailer.
- **PRs** target `master` and must pass CI. Expect automated review rounds (e.g. Copilot); address
  them as follow-up commits on the same branch. AI-generated PR bodies end with the Claude Code
  attribution line.
- **Feedback-pipeline lifecycle**: when a fix has actually shipped to users, comment on the reporting
  ClickUp task and move it to **"check on 20"** — the bspecs side runs a live verification wave.
  **Never close tasks directly**: a pass is closed by the resolution-note email flow (which also
  notifies reporters); a fail comes back on the "rejected fix" lane with the failing check cited.
- **Shipping chain**: a fix in `@bluestep-systems/b6p-core` reaches users only when this CLI (or the
  VS Code extension) releases with the bumped core. "Shipped" for the ClickUp lifecycle means the
  consumer release is published (npm publish on version tag; standalone binaries attach to the GitHub
  Release), not that a PR merged somewhere upstream.
- **Line endings**: repo blobs are LF. On a CRLF checkout (Windows `autocrlf`), a local
  `npm run format-check` can false-fail on every file while CI passes — trust CI, or run the check
  from an LF checkout. Do not commit a mass "reformat" for line-ending noise.

## Overriding Guidelines

In exceptional cases where a guideline is impractical, you may override it — but document the override
with a `//HUMAN-REVIEW-NEEDED` comment explaining the reason and what a human must review.
