# b6p-cli — agent rules

Single-package CLI `@bluestep-systems/b6p-cli`: the `b6p` command, published to public npm and
installed globally (`npm i -g @bluestep-systems/b6p-cli`). It is a thin front-end over
[`@bluestep-systems/b6p-core`](https://github.com/Bluestep-Systems/b6p-core) — the vscode-free core
shared with the [`vscode-extension`](https://github.com/Bluestep-Systems/vscode-extension). Entry
point [src/index.ts](src/index.ts); terminal adapters for core's provider interfaces in
[src/providers/](src/providers/).

## Hard constraints

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

- ES2022 / Node16, `strict`. Base options in `tsconfig.base.json`, `noEmit: true` in `tsconfig.json`
  — esbuild produces the artifact, not the compiler. `types: ["node"]` is set deliberately.
- **`typescript` is exact-pinned at 5.9.2**, matching the version core bundles, so npm dedupes to one
  copy. Do not float it to a range or a newer major without reading
  [docs/adr/0002-typescript-version-strategy.md](docs/adr/0002-typescript-version-strategy.md).
- **`copy-ts-libs` resolves `typescript` from core's directory, never the repo root** — the shipped
  `dist/lib/lib.*.d.ts` are read at runtime by the compiler esbuild inlined, so they must match *that*
  compiler. The failure mode is silent; the lib-set invariant test is what makes a mismatch red.
- Two artifacts from the same `dist/cli.js`: the npm package (primary) and standalone SEA binaries per
  OS/arch attached to each GitHub Release. → [docs/adr/0001-standalone-binary-toolchain.md](docs/adr/0001-standalone-binary-toolchain.md)

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
