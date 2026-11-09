# b6p-cli — agent rules

Single-package CLI `@bluestep-systems/b6p-cli`: the `b6p` command, published to public npm and
installed globally (`npm i -g @bluestep-systems/b6p-cli`). It is a thin front-end over
[`@bluestep-systems/b6p-core`](https://github.com/Bluestep-Systems/b6p-core) — the vscode-free core
shared with the [`vscode-extension`](https://github.com/Bluestep-Systems/vscode-extension). Entry
point [src/index.ts](src/index.ts) (version injection and `parseAsync` only); the command tree is
[src/program.ts](src/program.ts) and [src/commands/](src/commands/); terminal adapters for core's provider interfaces in
[src/providers/](src/providers/).

## Hard constraints

- **The command tree is noun-first: `b6p <subsystem> <verb>`.** The top level is a namespace of platform
  subsystems (`script`, `auth`, `sessions`, `config`), each owning its verbs. **Never add a top-level
  verb for platform work** (`b6p push` re-creates the collision the noun-first tree removed); `report`
  and `check-updates` are the two grandfathered exceptions, since they act on this installation. Add a
  command by writing `src/commands/<noun>.ts` exporting `register<Noun>Commands(program)` and adding one
  line to `registerCommands` in [src/commands/index.ts](src/commands/index.ts). The hidden
  `push`/`pull`/`audit`/`deploy`/`setup` aliases are a deprecation shim (removal unscheduled); do not
  add more, and do not hand-edit one half of a pair, since both come from one registrar so they cannot
  drift. [test/commandTree.test.ts](test/commandTree.test.ts) asserts the shape.
- **Command actions run inside `withCore`** ([src/context.ts](src/context.ts)). It owns SDK construction
  and the `finally` that disposes core, stops the spinner and closes readline; an action that builds its
  own providers or skips that teardown leaks an stdin handle and hangs the process. Emit
  machine-readable output with `ctx.emitJson(...)`, not a hand-rolled `--json` check.
- **A command that fails must exit non-zero.** Core reports most failures through `Prompt.error` and
  returns normally, so a `FailureTracker` ([src/exit.ts](src/exit.ts)) counts that channel and sets
  `process.exitCode` as each failure is recorded. Report a genuine failure with `ctx.fail(...)` and a
  *negative answer* with `prompt.info` (`b6p auth status` with no token is a success). **Never count
  `Logger.error`**: it is diagnostic and core logs recoverable conditions to it; counting it once made
  a successful first `script pull` exit `1`. Never make the exit code depend on `--json`/`--quiet`/
  `--verbose`; prefer `process.exitCode` to `process.exit()`, which can truncate a stdout write. Exit
  codes: `0`, `1`, and `130` for Ctrl-C at a prompt (`PromptCancelledError`). Known gap:
  `ScriptService.deploy` logs each target's failure to `logger.error` and still prints "Deploy
  complete!", so an all-failed deploy exits `0`; fixing it needs core.
- **Cross-package code goes through `@bluestep-systems/b6p-core`** — never relative paths into the
  core source. Shared orchestration belongs in core; this repo only adapts it to a terminal.
- **`b6p-core` is a bundled `devDependency`**, not a runtime one: esbuild inlines it (and
  `commander`, `fast-xml-parser`, …) into a single `dist/cli.js`, with only Node builtins external.
  If you externalize a package in [esbuild.js](esbuild.js), move it back to `dependencies` or
  `npm install` of the published CLI breaks.
- **Never use `any`.** If it seems unavoidable, leave a `//HUMAN-REVIEW-NEEDED` comment explaining
  why; a human who later accepts it adds `//REASON-FOR-ANY`. **Nothing enforces this** — there is no
  linter, so an explicit `any` compiles silently (`noImplicitAny` still catches the implicit case).
  Enforce it by reading the diff, not by trusting the build.
- **The npm artifact must stay unchanged by binary work.** Never alter `publish.yml`, the `bin`
  mapping, or `package.json` `files`/`dependencies` to accommodate the standalone binaries.
- **Keep types accurate** — correct signatures, never implied; types shared with the extension belong
  in core, not here.
- **Number formatting**: underscores for thousands (`1_000`, `10_000_000`).
- **New platform subsystems sit beside `script`, not on the root object.** Script-tree operations
  hang off core's `ScriptService` at `core.script` (`push`/`pull`/`audit`/`deploy`/`getSetupUrl`);
  account-level operations (`updateCredentials`, `report`, `setConfig`, `checkForUpdates`) stay
  directly on `core`.
- **Durable state is core's**, via its `SharedFilePersistence`. The CLI only adapts I/O, prompting,
  logging and progress to a terminal. The one platform-specific piece injected into it is
  `WindowsRestartManagerLockDiagnoser` ([src/lockDiagnoser/](src/lockDiagnoser/)), which names the
  processes holding a file when a Windows `rename` fails — best-effort, never throws.
- **Prompts are answered from a line queue.** Most users drive `b6p` through an agent whose stdin is
  not a TTY and ends at once, so [CliPrompt](src/providers/CliPrompt.ts) keeps one `line` listener
  and queues lines: one line answers one prompt, however they arrive, and end of input with the
  queue empty throws `NonInteractiveInputError`. Don't go back to `question()` per prompt: it drops
  a line that arrives with no question pending and never settles at end of input.
- **`push`'s exit code, error line and `--json` body come from [src/pushOutcome.ts](src/pushOutcome.ts)**,
  as pure functions with their own tests: `pushProblem` is the one verdict (a push that returned a
  result), `pushErrorOutcome` maps what core throws (`PublishRefusedError`, `ServerCompileRequestError`,
  `FileSendError`). `--json` is one shape for every push outcome (core's `PushResult` plus
  `declinedOverwrites` and `error`); add fields there, never a second shape. A snapshot push to a server
  without server-side compile saves the draft and prints exactly `cannot snapshot, only push saves`
  (`SNAPSHOT_REFUSED_LINE`, exit 1); scripts match on it, so do not reword it. Core says what
  happened and why; the "how to go on" lines (the `--overwrite` and delete commands) are the CLI's,
  quoted per `ShellDialect` (POSIX, or PowerShell on Windows without `MSYSTEM`/`SHELL`).

## Commands

```bash
npm run compile       # bundle → dist/cli.js (esbuild, production)
npm run build:sea     # standalone binary for this OS (Node SEA)
npm run watch         # rebuild on change
npm run check-types   # type-check only — the one semantic gate
npm run format        # prettier --write (.prettierrc: 120 width, 2-space, semicolons, es5 commas)
npm run format-check  # prettier --check
npm test              # bundle test/**/*.test.ts → dist-test/, run node --test
npm run clean
```

Run `npm run format` before committing. Smoke-test with `node dist/cli.js --help` (CI does this after
every compile). Tests are TS under [test/](test/), compiled rather than loader-run so they execute on
the whole CI Node matrix.

## Build and distribution

- Node **>=24** (`engines`; CI matrix 24 and 26, publish/release build on 24; `@types/node` stays on ^24 so no newer APIs creep in). ES2022 / Node16, `strict`. Base options in `tsconfig.base.json`, `noEmit: true` in `tsconfig.json`
  — esbuild produces the artifact, not the compiler. `types: ["node"]` is set deliberately.
- **`typescript` is a build-time devDependency only** (exact-pinned, 5.9.2 today): nothing compiles
  TypeScript at runtime any more. Compilation is the platform's, done server-side on push
  ([docs/adr/0003-server-side-compile.md](docs/adr/0003-server-side-compile.md), which supersedes
  [0002](docs/adr/0002-typescript-version-strategy.md)); core ships no compiler and the CLI bundles none,
  so there is no `copy-ts-libs`, no `ts-libs` SEA asset and no `typescriptLibDirs`. TypeScript 7 type-checks
  this repo cleanly; moving the pin is a lockfile change for whoever next regenerates it. **Never
  externalize or bundle a compiler** (an earlier plan did, and was dropped: ADR 0003).
- Two artifacts from the same `dist/cli.js`: the npm package (primary) and standalone SEA binaries per
  OS/arch attached to each GitHub Release. → [docs/adr/0001-standalone-binary-toolchain.md](docs/adr/0001-standalone-binary-toolchain.md)
  A binary line listed in `PRERELEASE_LINES` in [release.yml](.github/workflows/release.yml) (0.9 today) is
  marked pre-release before its binaries attach; promote it by removing the line and running
  `gh release edit <tag> --prerelease=false --latest`.

## Documentation, in the same change

| File | Update when |
|------|-------------|
| `README.md` | commands, flags, install or usage change |
| `AGENTS.md` (this file) | architecture, providers, conventions or process change |
| `CHANGELOG.md` | any user-visible change, fix, or breaking change |

`CLAUDE.md` is a one-line bridge to this file; do not put rules there. Outdated documentation is
worse than none — if uncertain, leave a `//HUMAN-REVIEW-NEEDED` note.

All AI-generated or AI-modified JSDoc **must** carry `@lastreviewed null`; a human replaces `null`
with the review date. Nothing enforces this here — b6p-core has a CI ratchet test for the new-block
case and this repo does not.

## Branch, commit, PR, ClickUp

- **Branches** carry the ClickUp id with the `CU-` prefix: `CU-<taskid>` or
  `<type>/<slug>-CU-<taskid>`. That exact spelling is what ClickUp's GitHub integration matches.
- **Commits** are conventional (`fix(scope):`, `feat:`, `docs:`, `release: vX.Y.Z — summary`) and
  reference the task as `(CU-<taskid>)`. AI-authored commits carry their `Co-Authored-By` trailer.
- **PRs** target `master` and must pass CI; address automated review rounds as follow-up commits on
  the same branch.
- **Feedback-pipeline lifecycle**: when a fix has actually shipped, comment on the reporting ClickUp
  task and move it to **"check on 20"**. **Never close tasks directly** — a pass closes via the
  resolution-note email flow, a fail returns on the "rejected fix" lane with the failing check cited.
- **"Shipped" means the consumer release is published** (npm publish on a version tag, binaries on
  the GitHub Release) — a fix in core reaches users only when this CLI or the extension releases with
  the bumped core, not when a PR merges upstream.
- **Line endings**: repo blobs are LF. On a CRLF checkout a local `format-check` can false-fail on
  every file while CI passes — trust CI, and never commit a mass reformat for line-ending noise.

Where a guideline is genuinely impractical you may override it, with a `//HUMAN-REVIEW-NEEDED`
comment saying why and what a human must check.
