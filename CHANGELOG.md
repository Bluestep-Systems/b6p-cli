# Changelog

All notable changes to `@bluestep-systems/b6p-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] — 2026-11-20

### Added

- **The marketplace repository lifecycle** (b6p-core 1.5.0, ClickUp 1k5g91bqyr2). Needs web-global 26.11.20.02 or later
  on the gateway's side; the routes answer 404 before that.
  - `b6p marketplace get <name>` shows one repository, an empty one just created included (`list` does not show it).
  - `b6p marketplace edit <name> [--description <t>] [--website <url>] [--topic <t>...] [--clear-topics]` changes only
    the options given; `--description ""` and `--website ""` clear those. With no option it is refused.
  - `b6p marketplace archive <name>` and `unarchive <name>`; an archived repository cannot be pushed to, edited or
    renamed, and the error says to unarchive it.
  - `b6p marketplace rename <name> <new-name>` prints the new clone URL and says existing clones keep working through
    a redirect, with the `git remote set-url origin <url>` to update one.
  - `b6p marketplace delete <name>` renames the repository to an archived tombstone (nothing is destroyed) and prints
    its name. It asks you to type the repository name, or takes `--yes`; with no terminal and no `--yes` it refuses.
  - `b6p marketplace tombstones` lists the deleted repositories.
  - `b6p marketplace purge <tombstone>` destroys a tombstone for good. It asks you to type the tombstone name, or
    takes `--confirm-purge` (`--yes` alone never purges, as it never makes a knowledge base public). Needs the
    history-manager grant besides `registry:push` and a fleet super user; the 403 says so.
  - `marketplace list` gains an ARCHIVED column (and `archived` in `--json`).

### Changed

- Depends on `@bluestep-systems/b6p-core` 1.5.0 (was 1.4.0).

## [1.3.0] — 2026-11-20

### Added

- **`b6p marketplace create <name> [--description <t>] [--website <url>] [--topic <t>...]`** (b6p-core 1.4.0, ClickUp
  1k5g91bqxwk) creates an empty, private marketplace repository, or adopts an existing empty one an earlier attempt
  left, and prints its clone URL. Needs `registry:push` and a fleet super user. The repository is not in
  `marketplace list` until its first push; push `main` alone first, then its tags in a second push. Refusals (name in
  use, another change under way, missing scope, not a super user, bad argument, forge unavailable) each say what to do.

### Changed

- Depends on `@bluestep-systems/b6p-core` 1.4.0 (was 1.3.0).

## [1.2.0] — 2026-11-19

### Added

- **Plain `git pull` and `git push` with the stored token: `b6p auth setup-git`** (b6p-core 1.3.0's
  `core.gitCredential`, ClickUp 1k5g91bqme2). It makes `b6p` git's credential helper, as `gh auth setup-git` does,
  for the gateway (when https) and the tenants you have pulled scripts from: an empty `helper =` and then
  `!b6p auth git-credential` per host in the file `git config --global` writes, so no other helper sees or keeps
  the token. It says what it wrote and where, what was set up already, and any entry of yours that still makes git
  ask another helper; running it again changes nothing. `--remove` takes b6p's entries out and reports any reset it
  had to leave. A plain push to a draft does not build or publish; that still takes `b6p script push`. Needs git
  2.27 (2.42 for setup); an older git fails setup with exit `1`, saying so.
- **`b6p auth set` offers to set git up** once a token is stored and git is not set up (Yes is the default). Piped,
  or under `--yes`, it never asks and prints a one-line hint instead; under `--json` it prints
  `{ authenticated, git: { configured, hint } }`.
- **`b6p auth status` reports git**: set up, not set up (and which other helper git asks), or git too old. Under
  `--json` it is the new `git` field.
- **`b6p kb pull` (a new clone) and `b6p script pull` print a one-line hint** to run `b6p auth setup-git` when git
  there would not use the token. The hint never fails the pull. Known gap: after a script pull the hint reads the
  git config in effect where the workspace is, not the draft clone's own config, since core's pull result does
  not name the draft folder yet.
- `b6p auth git-credential get|store|erase`, hidden from help, is the command git runs. It is recognised by its
  position (`b6p auth git-credential <action>`) and run before any option parsing, so `--help`, `--version` or an
  unknown flag after it change nothing; it writes only core's answer to stdout and always exits `0`, even when a
  cache fails to load in the background, stdout or stderr cannot be written, or Node is too old.

## [1.1.0] — 2026-11-19

### Added

- **`b6p kb create <name>` and `b6p kb set <name>`** register a global knowledge base and change its title, live
  branch or access (`public` or `private`), in one request each. Needs `kb:manage` to write (`kb set` reads with `kb:read`) and b6p-core 1.2.0. Making a knowledge
  base public asks first, naming it and warning that every commit reachable from the live branch, files since
  deleted included, becomes publicly readable (Cancel is the default); `--confirm-public` goes ahead, and the global `--yes` alone never makes it public. ClickUp 1k5g91bqhx6.

## [1.0.0] — 2026-11-17

### Fixed

- **A first pull or publish no longer stops at "HTTP 403"** (b6p-core 1.0.0 with bsjs-git 0.3.1, ClickUp 1k5g91bq9ef).
  The first platform request of a run sent a CSRF token that the sign-in had just dropped, and nothing retried it,
  so 0.9.0 could not pull or publish against 26.11.09.00. That request is now retried once with a fresh token.

### Changed (breaking)

- **The platform builds every push; the CLI bundles no compiler** (b6p-core 1.0.0,
  [ADR 0003](docs/adr/0003-server-side-compile.md)). `b6p script push` commits and pushes the draft over git, the
  platform builds that commit, and the draft folder is moved to its build commit; `--snapshot` publishes the build.
  Against a server that predates the git build a plain push is the git push alone (exit `0`), and `--snapshot`
  pushes the draft, takes no snapshot, prints `cannot snapshot, only push saves` and exits `1`.
- **New exit-`1` cases** (push and each deploy target): the server cannot take the snapshot; the build was not asked
  for (the platform's draft moved), was refused (`BUILD_REFUSED`: the draft moved, is over the build's size limit, or
  its repository or draft branch is missing), its request failed, its outcome is unknown, or it ended in a status
  that does not publish (busy, gate tripped, output withheld, ...); local files block taking in the build commit.
  Each prints a "To go on:" line naming the command to run. An unclean build on a plain push still exits `0` with a warning: a
  snapshot of it is refused until it builds cleanly.
- **`--json`**: core 1.0's push result (new `route`, `snapshotRefused`, `build`, `buildCommitSha`, `buildVouched`,
  `buildError`, `buildErrorKind`, `buildErrorReason`, `buildIncomplete`, `buildFastForward`) plus `declinedOverwrites` and a new
  `error` (`null`, or `{ kind, message, howTo }`, the same verdict as the exit code). `typeCheckDiagnostics` is now
  the platform's whole ERROR + WARNING count; `typeCheckErrors` lists the ones in the script's own sources, with
  `severity`.
- **`--fail-on-type-errors` / `failOnTypeErrors`** fail on any diagnostic the platform's build reports in the
  script's own sources (`typeCheckErrors`).
- **`--externally-built` is removed** (an unknown option): the platform reads each script's own `externallyBuilt`
  flag. A deploy config's `externallyBuilt` key, like any other unknown key at the top level or in a target, is
  refused by name before anything is pushed.
- **The standalone binaries are a normal release** again: `release.yml` no longer marks any line pre-release.
- **Node.js 24 or newer is required** (`engines.node` is `>=24`); Node 18 to 22 are no longer supported.
  CI tests Node 24 and 26, the publish and release builds run on Node 24, and `@types/node` is `^24`.
  The standalone binaries bundle their own Node and are unaffected. `engines` is only advisory to npm,
  so `b6p` also checks the Node major at startup and exits `1` with a clear message below 24.
- **Failing commands now exit `1`** where they used to exit `0` (for example `b6p script deploy
  missing.json`). A pipeline that relied on `b6p` never failing will go red. See Fixed below.

### Added

- `b6p kb list` shows a STATUS column and, after the table, one note per non-ok status present; `--json` carries `id`,
  `status` and `rawStatus`. `b6p kb pull` of a `row-only` knowledge base says it has no repository yet.
- `b6p auth token rotate`: when the rotation's outcome is unknown, the message now says b6p already sent the request a
  second time (core retries an unanswered rotation once with the same idempotency key).
- **Gateway: `409 live-branch-unprotected`** on `b6p kb push` says nothing was pushed, that the knowledge base's live branch is not protected on the forge, and to ask a Bluestep administrator to restore the protection before pushing again; under `--json` the failure document carries `code`.
- **Gateway contract delta (2026-11-10)**: `auth token create` without `--expires` mints for the sooner of 90 days and the stored token's own expiry and prints a note with the date when it cut it; a `--expires` (or `never`) past the stored token's expiry is explained, and so are the 400 (`invalid-request`), 409 `token-limit` (revoke an unused token) and 503 `registry-unavailable` answers. a 403 `restricted-mints-disabled` says token creation for that scope set is not enabled yet (only `mcp`-scoped tokens can be minted for now). `auth token list` shows expired tokens, `CREATED` (`unknown` when the gateway has no creation time) and an approximate `LAST USED`. A 403 `rewrite-not-permitted` (a `kb:rewrite` mint or rotate the account may not hold) says to ask an administrator or create the token without that scope, and under `--json` the failure document carries `reason` and `scope`.
- **`b6p kb list|pull|push`** - browse, clone and push the knowledge bases (global and tenant) the stored
  `b6pt_` token may reach, through the BlueStep gateway. Pulls fast-forward an existing clone and never
  overwrite local changes; pushes are fast-forward only, to the live branch.
- **`b6p marketplace list|pull`** - list marketplace repositories and clone one (optionally at a tag or
  branch with `--ref`) into a folder.
- **`b6p auth token list|create|revoke|rotate`** - manage your own gateway tokens. `create` and `rotate`
  print the secret once on stdout; `--expires` takes `90d` (default), another day count, an ISO date or
  `never` (asks first). Needs the `tokens:self` scope.
- A token the gateway minted but answered malformedly (`off-contract`) still has its secret printed once, with what to do next.
- `auth token create --expires` takes a day count, a date (start of that day, UTC) or a full ISO date-time
  with `Z` or an offset; anything else is refused before a request is sent. `marketplace pull --ref` also
  accepts full ref names (`refs/tags/v1.0.0`).
- `auth token revoke` of the token b6p itself is using asks first (Cancel by default; `--yes` alone declines).
  Under `--json` every secret-bearing body carries the secret in a top-level `secret` field. `kb push` works
  from a subfolder of a clone. The spinner is cleared before any stdout write.
- Gateway errors come with the fix: the scope to mint, `b6p auth set`, the dirty paths, "pull first",
  "choose another folder", "switch to the live branch".

- **`b6p script <verb>`** - script-tree operations now live under a `script` namespace:
  `b6p script push`, `pull`, `audit`, `deploy`, `setup`. The top level of `b6p` is becoming a namespace of
  platform subsystems (nouns), so later commands such as `b6p kb ...` can be added without colliding with
  a verb. It mirrors `B6PCore`, where each subsystem hangs off the composition root as its own service.
  The 0.9.0 flags (`--author`, `--enable-git`, `--fail-on-type-errors`) and the 0.9.0
  `--json` fields live on `b6p script push` / `pull` / `deploy`, and so on their deprecated aliases too.
- **`b6p auth status`** - reports whether an access token is stored (`{"authenticated": bool}` under
  `--json`). It never prompts, so unattended scripts can check for credentials without risking a hang.
- **Machine-readable failures.** Under `--json`, a failed command writes `{"error": "...", "errors": [...]}`
  to stdout instead of leaving stdout empty. This covers errors that are thrown (such as no input
  available for a prompt) as well as failures core reports, and never writes two documents.
- `130` is the exit code when a prompt is interrupted with Ctrl-C.

### Removed

- `copy-ts-libs`, the SEA `ts-libs` asset, `typescriptLibDirs` and the TypeScript lib invariant test:
  nothing compiles in the CLI any more.
- `--externally-built` (see above).

### Build

- `typescript` is an exact `7.0.2` devDependency, for `check-types` only; `test/noCompiler.test.ts` checks that
  `dist/cli.js` contains no compiler.

### Changed

- The old top-level `push`, `pull`, `audit`, `deploy` and `setup` still work as hidden aliases. They are
  registered from the same definition as the `script` commands, so their flags and behaviour cannot
  drift; they print a deprecation warning to stderr, carry the notice in their own `--help` text, and
  will be removed in a future release (no date yet).

  ```diff
  - b6p push --file ./src/app.ts --snapshot
  + b6p script push --file ./src/app.ts --snapshot
  ```

- `b6p auth set` is scriptable: `echo "$B6P_TOKEN" | b6p auth set`. A fresh install used to prompt twice
  and fail on the second prompt at end of input.
- Reorganised `src/` around the command tree: `src/commands/` holds one module per noun, `src/context.ts`
  the SDK construction and the `withCore` wrapper every action runs inside, `src/program.ts` the root
  command. `src/index.ts` is only version injection and `parseAsync`.

### Fixed

- **Failing commands exit non-zero.** Core reports most failures through `Prompt.error` and returns
  normally, so commands such as `b6p script deploy missing.json` printed an error and exited `0`.
  `CliPrompt` now counts what crosses its error channel and sets `process.exitCode`. `Logger.error` is
  deliberately not counted (core logs recoverable conditions there). Reporting a value is still success:
  `b6p auth status` with no token stored exits `0`.
- **`b6p script audit` outside a script tree fails** instead of printing `null` at exit `0`.
- **`b6p check-updates` works.** The CLI never passed `updateServiceConfig` to core, so the command could
  only report "Update service is not configured". It now checks this repository's own releases.
- The CLI now calls `B6PCore.dispose()`, so core's session-cleanup timer no longer outlives the command.
- Fatal errors set `process.exitCode` instead of calling `process.exit()`, which could truncate a `--json`
  write. A closed stdout pipe (`b6p --json report | head -1`) is a clean exit rather than an `EPIPE`, and keeps
  a failure exit code the command had already set.
- The standalone-binary build smoke test looks for `script` in `--help` rather than `push`.
- CI: `npm ci` retry loops now fail the step when all three attempts fail (they used to fall through to a misleading type error), and the Intel macOS binary builds on `macos-15-intel` (the retired `macos-13` runner never ran).
- The test build shares the real build's `external` list (`NODE_EXTERNALS` in `esbuild.js`).

## [0.9.0] — 2026-11-16

Depends on b6p-core 0.9.0, which moves scripts to git: a script's draft and snapshot are a git repository,
and its history is its git history. **Platform floor:** the platform's git publishing. Today's server works
through its `enableGitPublishing` switch (the first push, or `pull --enable-git`, turns a script over); the
release that moves script history to git makes it the only mode, and refuses WebDAV writes to a script's draft
and snapshot. 0.8.x clients stop working against a script once it is on git: update them to this version.

### Changed (breaking, user-visible)

- **`push --json` lost `historyRecorded` and gained `commitSha`, `publishedSha`, `publishError` and
  `switchedToGit`.** Every other field is unchanged. `commitSha` is the draft commit after the push,
  `publishedSha` the commit a snapshot published, `publishError` why a publish failed, `switchedToGit` that this
  push moved the script from WebDAV to git. Anything that reads `historyRecorded` must read `publishedSha`
  (snapshot) or `commitSha` instead; the new shape is in the README.
- **New exit-code rules.** `1` when `pushed` is false. On a snapshot, also `1` when `publishedSha` is `null`,
  `publishError` is set, or `liveVerified` is `false` . Otherwise
  `0`. A plain push is judged by `pushed` alone.
- A push that stops after switching a script to git (a declined overwrite, for instance) reports `switchedToGit: true`; the switch stands.
- **A push is a git commit and needs an author.** `--author "Name <email>"`, or `b6p config set author "Name
  <email>"`, or (as before for git users) `git config user.name/user.email` or `GIT_AUTHOR_*` in the
  environment. With none, the push exits `1` and says how to fix it.
- **Pulls and pushes work on the script's git draft.** `pull` clones it (or fast-forwards an existing clone);
  there is no WebDAV draft or snapshot transfer any more. `audit` needs a pulled git working copy.
- **Switching a script from WebDAV to git is one-way,** and the CLI says so: a push prints it (`switchedToGit` in
  `--json`), and `pull` asks first (`[Cancel]` first, so `--yes` declines).

### Added

- `--fail-on-type-errors` on `push` and `deploy` (and `failOnTypeErrors` in deploy configs). Type errors in a script's own sources are now warnings that exit `0` by default (0.8 failed a snapshot on them); errors in `.d.ts` files never count; syntax and emit errors still exit `1`.

- Build manifest: a push that builds writes `<outDir>/.b6p-build.json` with the build output (a draft with no TypeScript source needs none), and the platform refuses to publish a draft whose sources changed since the build. The refusal (`BUILD_STALE`, `BUILD_MANIFEST_MISSING`, `BUILD_MANIFEST_INVALID`) exits `1`, lists the files, says to rebuild and push, and appears in `--json` as `publishRefusal`. `--externally-built` (push) and `externallyBuilt` (deploy config) mark a script a bundler builds.

- `--enable-git` on `pull` (with a URL, `--file` or the current folder) and `push`: switch a script still on WebDAV to git without asking. Without it the switch is asked about and `--yes` declines.
- Clear messages, each exiting `1` with nothing changed, for a declined switch, a wrong branch checked out, staged-only changes and symlinks that escape the draft folder.
- `b6p push --author` and `b6p deploy --author`; `author` and `message` in deploy config files.
- A push prints the draft and published commit SHAs.
- `deploy` exits `1` when no author resolves (checked before anything is pushed) or when any target failed, was not pushed, or had its publish refused, and prints a line per target with its commit and published SHAs (and a switch to git). Before, it printed "Deploy complete!" and exited `0` whatever happened.

## [0.8.2] — 2026-10-20

### Fixed

- **`b6p pull` no longer stops part-way with `Could not parse upstairs etag`**
  ([#35](https://github.com/Bluestep-Systems/b6p-cli/issues/35)). Files last saved on the platform
  before about May 2026 come back with a weak numeric ETag (`W/"<ms>-<id>"`) that the pull didn't
  recognise, so it stopped at the first such file, exited `1`, and never refreshed `declarations/`.
  It now treats those files like other files that carry no content hash: it skips the integrity
  check and keeps going, and the file keeps its push/pull record. Comes from
  [b6p-core 0.8.1](https://github.com/Bluestep-Systems/b6p-core/releases/tag/v0.8.1), now bundled.
  If you used the `.gitignore` workaround from the issue, take the entries out and pull again.

## [0.8.1] — 2026-09-29

### Fixed

- **`b6p auth set` accepts a `b6pt_` platform access token again.** 0.8.0 refused any token starting
  with `b6pt_` as a "gateway token", but that is the access token the CLI signs in with, so the
  refusal blocked sign-in. The check is gone: `b6p auth set` and the first-use token question store
  whatever token you enter, as in 0.7.0. (The 401 that led to the check came from an account that
  had lost its access, not from the kind of token.)

## [0.8.0] — 2026-09-25

### Changed (breaking, user-visible)

- **`--yes` and an empty answer now decline overwrites and deletes.** Core 0.8.0 puts the safe
  answer first in every prompt that overwrites or deletes something on the platform (`[Cancel] /
  Overwrite all`, `[No] / Yes`), and `--yes` or pressing Enter takes that first answer. Before, `--yes`
  overwrote files changed on the platform and deleted platform-only files without showing either
  question. A script or agent that relies on `--yes` now gets exit `1` where it used to overwrite
  (with the command that confirms the files), and keeps platform-only files where it used to delete
  them (exit `0`). The old per-file answer `Overwrite` no longer matches the question, so it declines
  too; the answer is now `Overwrite all`.
- **`--yes` now prints every question it answers**, with the options and the answer it took, on
  stderr (also with `--json`). A destructive prompt says `--yes` never confirms an overwrite or a
  delete.

### Added

- **`b6p push --overwrite <path>`** (repeatable) confirms overwriting that file on the platform up
  front, so a push that `--yes` would stop can go through for exactly the files you checked. The
  path is the one the overwrite question lists (e.g. `scripts/app.ts`).
- **A declined overwrite now says how to go on**: after core's message (which files, and why), the
  CLI prints the command that repeats the push with one `--overwrite` per file. A push that kept
  platform-only files prints the command that deletes them (without `--yes`, answering `Yes`). Both
  are quoted for your shell: POSIX, or PowerShell on Windows outside Git Bash / MSYS.
- **`--json` for a declined overwrite.** The push used to print nothing on stdout; it now prints the
  same object as any push, with `pushed: false` and the files in a new `declinedOverwrites` field
  (`[]` on every other push), and exits `1`.
- **`b6p auth set` refuses a gateway token.** A value starting with `b6pt_` is the token for the
  BlueStep AI tools, not the CLI; storing it made every later call fail with `HTTP Error: 401`. It is
  now refused with a message saying so, and nothing is stored (exit `1`). The same check runs on the
  token question any command asks on first use.
- **`b6p --help` and `b6p push --help`** say what `--yes` answers, the two questions a push can
  ask, `--overwrite`, piping answers, the exit codes and the `--json` shape.

### Changed

- **One overwrite question per push, before anything is uploaded.** Core 0.8.0 lists every file
  that would overwrite a platform change in a single `[Cancel] / Overwrite all` question, so a
  declined or unanswered question can no longer leave a push half done. New files and files already
  equal to the platform copy no longer ask.
- **Bundles `@bluestep-systems/b6p-core` 0.8.0.** A snapshot push now checks, before uploading
  anything, that the compiled `scripts/app.js` exists and has code; checks every upload to
  `snapshot/`; and reads each live copy back afterwards, sending it again once if it doesn't match.
  A re-push also repairs a live copy left stale by an earlier failed push, even when nothing changed
  locally.

### Fixed

- **`b6p push --snapshot` no longer exits `0` when the live version is broken.** It exits `1` when
  nothing was uploaded (`pushed: false`, e.g. a blank or types-only `app.ts`) and when a live copy
  is still missing, unreadable or different after the re-send (`liveVerified: false`, with the files
  in `liveMismatches`). `--json` prints the new fields (`liveVerified`, `liveMismatches`,
  `keptPlatformOnly`). A copy served without a content hash can't
  be compared (`liveVerified: null`): that prints a warning on stderr and still exits `0`.
- **A refused upload prints its details once**, not a second time after `[ERROR] Failed to push …`.
- **Piped answers reach every prompt, not only the first.** When stdin delivers every line at once
  (`printf 'Overwrite all\nYes\n' | b6p push …`, or `< answers.txt`), the second line used to arrive
  while no prompt was waiting and was lost, so the second prompt failed with "No input available".
  Each line now answers the next prompt. On a non-terminal stdin the answer is written after its
  prompt, so the output shows what was answered (never for a token).
- **An answer that matches none of a prompt's options now says so** (`"Overwrite" is not one of the
  answers (Cancel, Overwrite all), so none was chosen.`) instead of declining silently.

## [0.7.0] — 2026-08-24

Entry added on 2026-09-25: this release shipped without one.

### Changed

- **Bundles `@bluestep-systems/b6p-core` 0.7.0.** The type-check a snapshot push runs before
  publishing now loads the component's declaration files, so platform globals (`B`, `console`,
  `Bluestep`, `Record_*`, …) no longer come back as hundreds of false `Cannot find name`
  diagnostics. What remains is real.

### Fixed

- **`b6p push --snapshot` exits `1` when the type-check reported diagnostics.** The platform runs
  the emitted JavaScript without type-checking it, so this push is the only type gate; CI can now
  catch a publish that went out un-type-checked. A plain push (no compile) and a clean snapshot
  still exit `0`. Client-bundle diagnostics (e.g. a merge report's `static/`) stay advisory.

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
