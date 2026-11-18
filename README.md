# @bluestep-systems/b6p-cli

Headless command-line interface for the [BlueStep](https://www.bluestep.net/) platform.

Script management is the subsystem it covers today — pull components from the platform,
push changes back, audit local vs. server, git history, and deploy across targets —
under `b6p script`. Further subsystems will appear alongside it as top-level names.

The CLI shares its core implementation
([`@bluestep-systems/b6p-core`](https://github.com/Bluestep-Systems/b6p-core)) with the
[VS Code extension](https://github.com/Bluestep-Systems/vscode-extension) and can be used standalone in
terminals, CI pipelines, and scripts.

## Installation

This package is published to the public [npm registry](https://www.npmjs.com/), so no authentication is
required to install it. Requires **Node.js 24 or newer** (the standalone binaries below bundle their own).

1. Install globally:

   ```bash
   npm install -g @bluestep-systems/b6p-cli
   ```

2. Verify:

   ```bash
   b6p --help
   ```

## Standalone binary (no Node required)

For machines without Node.js or npm, each
[GitHub Release](https://github.com/Bluestep-Systems/b6p-cli/releases) also ships a self-contained
`b6p` binary with Node bundled in — download one file and run it.

| Platform | Asset |
|---|---|
| Windows (x64) | `b6p-windows-x64.exe` |
| macOS (Intel / x64) | `b6p-macos-x64` |
| macOS (Apple Silicon / arm64) | `b6p-macos-arm64` |

Each asset has a matching `<asset>.sha256` checksum sidecar. Download the latest with:

```
https://github.com/Bluestep-Systems/b6p-cli/releases/latest/download/<asset>
```

Install by saving the file into the shared BlueStep tools directory under the bare command name, then
ensuring that directory is on your `PATH`:

| | Directory | Save as |
|---|---|---|
| Windows | `%LOCALAPPDATA%\BlueStep\bin\` | `b6p.exe` |
| macOS | `~/.bluestep/bin/` | `b6p` |

Then `b6p <command>` works from any shell, with no Node or npm present. On macOS the binary is ad-hoc
signed (so it runs) but not notarized; a copy downloaded via a browser may be quarantined by Gatekeeper —
clear it with `xattr -d com.apple.quarantine ~/.bluestep/bin/b6p` and make it executable with
`chmod +x ~/.bluestep/bin/b6p`.

The npm install above is unchanged and remains the recommended path wherever Node is available.

## Signing in

`b6p` signs in with your BlueStep platform access token, which starts with `b6pt_`. It is the same
token the BlueStep AI tools use for the gateway MCP (`B6PT_TOKEN`), so if you already have one, use it
here too. To make one: **Tools → Organization Admin → Super → Global Users → Access Tokens → Create
New Token**.

Store it with:

```bash
b6p auth set
```

If no token is stored, the first command you run asks for it. A `401` with a `b6pt_` token usually
means the token expired or its account lost access, not that it is the wrong kind of token.

## Commands

`b6p` is organised as `b6p <subsystem> <verb>`. Each top-level name is a part of the
platform; the verbs beneath it act on that part.

### `b6p script` — script trees

| Command | Purpose |
|---|---|
| `b6p script pull <webdav-url>` | Pull a script by URL (clones its git draft) |
| `b6p script pull <webdav-url> --enable-git` | Same, and switch a script still on WebDAV to git without asking (one-way) |
| `b6p script pull --file <path>` | Pull using metadata stored with a local file |
| `b6p script push --file <path>` | Push local files to the platform |
| `b6p script push --file <path> --snapshot --message "…"` | Commit the draft with a message and publish it |
| `b6p script push --file <path> --author "Jane Doe <jane@example.com>"` | Push as a given commit author |
| `b6p script push --file <path> --overwrite <file>` | Push, overwriting a file that changed on the platform |
| `b6p script audit --file <path>` | Diff local vs. server |
| `b6p script audit --file <path> --pull` | Audit and pull if differences found |
| `b6p script deploy <config.json>` | Multi-target deploy from a config file |
| `b6p script setup --file <path>` | Print the web-UI setup URL for a script |

> **Moved.** These were previously top-level (`b6p push`, `b6p pull`, …). The old
> spellings still work but are deprecated, warn on use, and **will be removed in a future release** —
> the top level is being kept free for other platform subsystems.

### `b6p auth` — credentials

| Command | Purpose |
|---|---|
| `b6p auth set` | Set or update the access token |
| `b6p auth status` | Report whether a token is stored (never prompts) |
| `b6p auth clear` | Clear the stored token |
| `b6p auth token list` | List your own tokens, expired ones included, marked `(expired)` (the secret is never shown) |
| `b6p auth token create --alias <a> --scopes <s,…> [--expires <90d\|date\|date-time\|never>]` | Mint a token; the secret is printed once |
| `b6p auth token revoke --tokenid <alias\|id>` | Revoke one of your tokens |
| `b6p auth token rotate --tokenid <alias\|id>` | Replace a token (same alias, scopes and end date); the old one dies at once |

`auth token` manages only your **own** tokens and needs the `tokens:self` scope. `create` and `rotate`
print the new secret **once**, alone on stdout (so `TOKEN=$(b6p auth token create …)` captures it), with
the details and a "store it now" note on stderr. Under `--json` the secret is the top-level `secret`
field of the body, on success (`create`, `rotate`) and on the failure bodies that still carry one (a token
that could not be stored, a malformed gateway answer), which also have `error`, `errors`, `operation`
and `stored`. A new token's
scopes can never exceed the token b6p is using. The default lifetime is 90 days, or until the token b6p is using expires if that comes first (the command says so and gives the date); `--expires 30d`, a date
(`2027-03-01`, the start of that day UTC) or a full date-time with `Z` or an offset
(`2027-03-01T12:00Z`, `2027-03-01T12:00:00+02:00`) picks another. `--expires never` warns and asks first (the safe answer, Cancel, is the
default); under `--yes` it goes ahead only because you typed `never` yourself. Rotating the token b6p is
using runs at once and stores the new secret for b6p. Revoking it asks first (Cancel is the default, so
`--yes` alone declines, and `--json` with no input fails) because it leaves b6p holding a dead token until
you run `b6p auth set`; revoking any other token runs at once.

A new token can never outlive the token that creates it: an explicit `--expires` (or `never`) past that date is refused (`403`), and the error says when the stored token expires. Until the gateway's rollout switch is flipped, only tokens with just the `mcp` scope can be minted (`not enabled yet`). You may hold at most 50 live tokens; past that, revoke one you no longer use. `list` shows a token whose creation time the gateway never recorded as `unknown`, and `LAST USED` is approximate (the gateway stamps it at most every 12 hours).

### `b6p kb` — knowledge bases

| Command | Purpose |
|---|---|
| `b6p kb list [--scope global\|tenant] [--tenant U…]` | List the knowledge bases you may read, whether you may push, and each one's STATUS (`ok`, `branch-mismatch`, `repo-only`, `row-only`, `unconfirmed`, `undescribed`; a note under the table explains each one present) |
| `b6p kb pull <ref> [dir]` | Clone a knowledge base into a folder (default `./<name>`, or `./<tenant>-<name>` for a tenant's), or fast-forward an existing clone |
| `b6p kb push [dir]` | Push a clone (default: the current folder, or the clone that contains it) to the knowledge base's live branch |

`<ref>` is `<name>` for a global knowledge base or `U<number>/<name>` for a tenant's; names and the tenant match in any letter case, and the local folder uses the canonical name. Pulls never
overwrite local changes (the dirty paths are listed) and pushes are fast-forward only: if the knowledge
base moved on, pull first. Pushing needs push rights on that knowledge base as well as the `kb:push` scope.

### `b6p marketplace` — marketplace repositories

| Command | Purpose |
|---|---|
| `b6p marketplace list` | List repositories with their default branch and tags |
| `b6p marketplace pull <name> [dir] [--ref <tag\|branch>]` | Clone a repository into a folder (default `./<name>`), or fast-forward an existing clone |

A plain working clone, unrelated to any script. There is no push.

### `b6p schema` — declarative schema manifests

Super users only. Every command takes exactly one of `--org <url>` (any URL on the org) or `--u <Uxxxxxx>` (the org's U,
resolved through b6p's U cache, which asks BlueHQ on a miss; an unknown U says to pass `--org <url>` instead). Giving both, or neither, is a usage error (exit 1). Manifests are local YAML files.

| Command | Purpose |
|---|---|
| `b6p schema generate <id...> --org <url>\|--u <U> [--portable] [--no-closure] [-o FILE]` | Write the manifest describing the named objects as they stand now (YAML to stdout, or FILE; an existing FILE is replaced only if you answer `Overwrite` to a destructive question, which `--yes` never accepts) |
| `b6p schema recipe <NAME> --org <url>\|--u <U> [-o FILE]` | Run a recipe (`LINK_VIEW_GRANTS`): the manifest goes to FILE or stdout, the findings to stderr (`-o` asks before replacing a file, as above) |
| `b6p schema test <FILE> --org <url>\|--u <U> [--warn-names]` | Dry run: the gate verdict, refusals, and the plan (counts by action, then each action that changes something with its deltas `from → to`, and warnings). Nothing is written; the key is never printed |
| `b6p schema apply <FILE> --org <url>\|--u <U> [--confirm] [--warn-names]` | Test, show the plan, ask, then apply exactly the manifest that was tested |

`apply` asks `Apply this plan?` (default No). `--confirm` answers yes without asking; the root `--yes` takes the default
answer (No), so it declines here. Without `--confirm` and without a terminal (or piped `Yes`) it ends with
`NonInteractiveInputError` and applies nothing. A plan that did not pass, or
changes nothing, is never asked about. `--warn-names` also warns when two objects of one kind share a display name (an org whose server predates the
warning refuses it: the message says to run without the flag).
A `STALE` or `KEY_INVALID` refusal means the org changed or the key (ten minutes, one use) is spent: re-run `apply`.

Exit codes: `generate`, `recipe` 0 done, 1 failed. `test` 0 the gate passed (a plan with no changes included), 1 it
did not. `apply` 0 applied or nothing to change, 1 the gate did not pass or the server did not apply, 2 declined at
the prompt. `--json`: `generate` `{ manifest, file, error }`; `recipe` `{ manifest, findings, file, error }`; `test`
core's result plus `error`; `apply` `{ test, declined, apply, error }`. The one-use `schemaMutationKey` is in no
`--json` body (`apply` mints its own). `error` is `null` on success, else `{ kind, message, howTo }`, and a command
that fails before it has a result (not a super user, an org that cannot be resolved, an unreadable manifest, an
`-o` file left alone, an apply whose answer never came back) prints its own family's body, empty, with `error` set.
`kind` is one of `GATE_FAILED`, `TEST_REFUSED`, `NOT_APPLIED`, `DECLINED`, `SUPER_ONLY`, `SERVER_TOO_OLD`,
`ORG_UNKNOWN`, `ORG_LOOKUP_FAILED`, `UNKNOWN_RECIPE`, `MANIFEST_UNREADABLE`, `OUTPUT_EXISTS`,
`APPLY_OUTCOME_UNKNOWN` (the connection failed after the yes: the key is spent and the plan may or may not have
been applied, so run `b6p schema test` again to see whether it still changes anything).

### Gateway token scopes

`kb` and `marketplace` talk to the BlueStep gateway (`gatewayUrl`, default `https://gateway.bluestep.net`;
change it with `b6p config set gatewayUrl <url>`) using the same stored `b6pt_` token. Mint a token with
the scopes you need:

| Scope | For |
|---|---|
| `kb:read` | `kb list`, `kb pull` |
| `kb:push` | `kb push` |
| `registry:read` | `marketplace list`, `marketplace pull` |
| `tokens:self` | `auth token …` |
| `kb:rewrite` | rewriting a knowledge base's history (not a `b6p` command); mintable and rotatable here only if the token b6p uses holds it |

### Everything else

| Command | Purpose |
|---|---|
| `b6p sessions clear` | Clear all active sessions |
| `b6p config set <key> <value>` | Set a configuration value |
| `b6p config reset` | Reset all settings to defaults |
| `b6p report` | Report cached state |
| `b6p check-updates` | Check for CLI updates |

Most commands accept `--json` for machine-readable output and `--yes` to answer every question with
its default (and print what it answered). Run `b6p <command> --help` for full options.

## Pushing

A push can ask two questions. Both default to the safe answer, which `--yes` and an empty answer
take, so `--yes` never overwrites or deletes anything on the platform:

1. **Before uploading anything**, when files would overwrite a platform version nobody here has seen
   (it changed on the platform since your last push or pull, or this machine never synced it):
   `[Cancel] / Overwrite all`. One question lists every such file; Cancel stops the push with nothing
   uploaded (exit `1`). New files and files already equal to the platform copy never ask.
2. **After uploading**, when the platform has files your draft doesn't: `[No] / Yes` to delete them.
   No keeps them (exit `0`).

When question 1 is declined, the CLI prints the command that confirms it. After checking the
platform versions (`b6p script audit`), confirm specific files up front with `--overwrite`, once per file,
using the path the question listed:

```bash
b6p --yes script push --file <path> --snapshot --overwrite scripts/app.ts --overwrite README.md
```

Question 2 has no flag: run without `--yes` and answer `Yes`. Answers can be piped, one line per
question, in order (`printf 'Overwrite all\nYes\n' | b6p script push --file <path>`, or `< answers.txt`;
in PowerShell, `'Overwrite all', 'Yes' | b6p script push --file <path>`). The commands the CLI prints are
written for your shell: POSIX, or PowerShell on Windows outside Git Bash.

### Git, authors and switching

A script's draft and its published snapshot are a git repository on the platform; a push commits your
`draft/` folder to it, and `--snapshot` (or `--message`, which implies it) also publishes that
commit. Its history is its git history. Requires a platform with git publishing for scripts (today's
server: its `enableGitPublishing` switch); a script still on WebDAV is switched
to git by its first push or by `b6p script pull --enable-git`. **The switch is one-way**: afterwards the
script's draft and snapshot refuse WebDAV writes. The CLI says so when it happens
(`switchedToGit`).

Every commit needs an author. In order, the first complete one is used: `--author "Name <email>"`;
for `deploy`, the config file's `author`; the stored default (`b6p config set author "Name <email>"`);
`git config user.name` and `user.email` for the script folder; then `GIT_AUTHOR_NAME` and
`GIT_AUTHOR_EMAIL` (or the `GIT_COMMITTER_*` pair) in the environment. With none of them the push
stops with exit `1` and prints those fixes; nothing is ever committed as nobody.

`b6p script pull` and `b6p script push` without `--enable-git` ask before switching a WebDAV script (`[Cancel]` first),
and `--yes` declines, so an unattended run never switches anything and exits `1` (push) with nothing changed.
`--enable-git` works with a URL or with `--file`/the current folder.

Refusals that change nothing and exit `1`: a declined switch, a draft folder with a branch other than
`draft` checked out (push), staged-only changes that a pull would discard, and symbolic links that
would let a pull write outside the draft folder. Each message says how to fix it.

### What the platform does with a push

A push commits the draft and pushes it over git; then the **platform** builds that commit (b6p bundles no
compiler) and commits its output, plus a build manifest when the build is clean, as one build commit. The
draft folder is moved to that build commit, and `--snapshot` publishes it. `b6p` asks the server for its
version first (`--verbose` prints the route; `--json` carries it as `route`):

| Server | `b6p script push` | `b6p script push --snapshot` |
|---|---|---|
| Builds git drafts (at or above core's minimum, or a `dev` build) | pushed, then built | pushed, built, and the build published |
| Older, unreadable version, or no minimum known | pushed; nothing built (exit `0`) | pushed, **no snapshot**: prints `cannot snapshot, only push saves` and exits `1` |

The platform's diagnostics are printed on stderr. An unclean build (an `ERROR` diagnostic: syntax, emit
or configuration) commits its output without a manifest: the push still exits `0` with a warning, and a
snapshot of that draft is refused until it builds cleanly. There is no `b6p script check` (a dry-run
build is waiting on a platform endpoint).

### Exit codes

| Result | Exit |
|---|---|
| Pushed and built; kept platform-only files, a switch to git, a plain push to an older server, an unclean plain push, or a read-back that could not run (`liveVerified: null`) are still fine | `0` |
| The user cancelled at the target-URL prompt | `0` |
| Nothing was pushed (`pushed: false`): bad `--root`, empty draft, an overwrite not confirmed, no commit author, an upload refused | `1` |
| Snapshot, and the server cannot take one (`snapshotRefused`) | `1` |
| The build was not asked for (`buildErrorKind: "not-requested"`: the platform's draft moved), was refused (`"refused"`, with `buildErrorReason`) or its request failed (`buildError`) | `1` |
| The build ended in a status that does not publish, or its outcome is unknown (`buildIncomplete`) | `1` |
| Local files block moving the draft folder to the build commit, or the move failed (`buildFastForward.state` `blocked` / `failed`) | `1` |
| Snapshot, and the publish was refused or failed (`publishError`), published nothing (`publishedSha: null`), or reads back at another commit (`liveVerified: false`) | `1` |
| `--fail-on-type-errors` (or `failOnTypeErrors: true` in a deploy config), and the build reported diagnostics in the script's own sources (`typeCheckErrors` not empty) | `1` |

Every failure prints a `To go on:` line saying what to run: for example `b6p script pull`, then push again,
after the platform's draft moved or when the build's outcome is unknown; push again after a busy or
incomplete build; move or delete the listed files when they block the build commit; update b6p for a build
status it does not know. Diagnostics are **warnings by default** (the platform runs the emitted JavaScript);
those in a `.d.ts` never count. Add `--fail-on-type-errors` to push, snapshot or deploy to make them fail.

### `--json`

`--json` prints one object on stdout, the same shape for every outcome (agents parse it): core's push result
plus `declinedOverwrites` and `error`.

```json
{
  "pushed": true,
  "commitSha": "3f2a…",
  "publishedSha": "9c1b…",
  "publishError": null,
  "publishRefusal": null,
  "switchedToGit": false,
  "route": { "mode": "server-build", "reason": "at-or-above-floor", "serverVersion": "…", "required": "…" },
  "snapshotRefused": null,
  "build": { "status": "COMPILED", "rawStatus": "COMPILED", "errors": 0, "warnings": 0, "…": "…" },
  "buildCommitSha": "7d4e…",
  "buildVouched": true,
  "buildError": null,
  "buildErrorKind": null,
  "buildErrorReason": null,
  "buildIncomplete": null,
  "buildFastForward": { "state": "fast-forwarded", "blockedPaths": [], "error": null },
  "typeCheckDiagnostics": 0,
  "typeCheckErrors": [],
  "liveVerified": true,
  "liveMismatches": [],
  "keptPlatformOnly": [],
  "declinedOverwrites": [],
  "error": null
}
```

- `commitSha`: the draft commit this push made (or the one already there); `buildCommitSha`: the platform's
  build commit after it, `null` when it made none. `publishedSha`: the commit published (snapshot only).
- `route` / `snapshotRefused`: which route the push took, and why a snapshot was refused (`too-old`,
  `unknown`, `floor-unset`, with the versions).
- `build`, `buildVouched`, `buildError` / `buildErrorKind` / `buildErrorReason` (`DRAFT_MOVED`, `DRAFT_TOO_LARGE`,
  `REPO_MISSING`, `DRAFT_BRANCH_MISSING` when the platform refused the build), `buildIncomplete` (`{ status, rawStatus, description }`)
  and `buildFastForward` (`{ state, blockedPaths, error }`): what the platform's build came to.
- `publishRefusal`: `{ "reason", "withheld" }`, straight from the platform, when it refused the publish
  (`BUILD_STALE`, `BUILD_MANIFEST_MISSING`, `BUILD_MANIFEST_INVALID`, `DRAFT_MOVED`, ...).
- `typeCheckDiagnostics`: the platform's whole `ERROR` + `WARNING` count. `typeCheckErrors`: those in the
  script's own sources (`{ file, line, column, code, message, severity }`, at most 20); `.d.ts` diagnostics are
  never included.
- `error`: `null` when the push succeeded, else `{ "kind", "message", "howTo" }`, the same verdict as the exit
  code. `kind` is one of `NOTHING_PUSHED`, `SNAPSHOT_REFUSED`, `BUILD_NOT_REQUESTED`, `BUILD_REFUSED`, `BUILD_REQUEST_FAILED`,
  `BUILD_OUTCOME_UNKNOWN`, `BUILD_INCOMPLETE`, `BUILD_BLOCKED`, `BUILD_TAKE_IN_FAILED`, `PUBLISH_REFUSED`,
  `PUBLISH_FAILED`, `NOT_PUBLISHED`, `LIVE_MISMATCH`, `TYPE_ERRORS`, `OVERWRITE_DECLINED`, `NO_AUTHOR`,
  `AUTHOR_INVALID`, `GIT_REFUSED`.
- A declined overwrite prints `pushed: false` with the files in `declinedOverwrites`; a cancelled target-URL
  prompt prints `{ "cancelled": true }`. Questions, warnings and next steps go to stderr.

### Deploy

`b6p script deploy <config.json>` pushes the source draft to each target, and each target's platform builds it:

```json
{
  "sourceRootPath": "./my-script",
  "targets": [{ "url": "https://…/files/123/draft/", "snapshot": true }],
  "author": { "name": "Jane Doe", "email": "jane@example.com" },
  "message": "Deploy from CI",
  "enableGit": false,
  "failOnTypeErrors": false
}
```

Those are the only keys (and `url` / `snapshot` in a target): any other key is refused by name before anything is
pushed. `externallyBuilt` was removed in 1.0.0, since the platform reads each script's own flag. `author` (an object,
or `"Jane Doe <jane@example.com>"`) and `message` are optional and apply to every target; `b6p script deploy
--author "…"` overrides the file's author. `deploy` exits `1` if no author resolves (nothing is pushed then) or if
any target fails by the push rules above.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The command completed without reporting an error |
| `1` | The command failed, or its arguments were rejected |
| `130` | A prompt was interrupted with Ctrl-C |

`--quiet` and `--json` change what is printed, never the exit code, so it is safe to gate a
pipeline on:

```bash
set -e
b6p script push --file ./src/app.ts --snapshot --message "release $VERSION"
```

Under `--json`, a failure also writes a machine-readable payload to stdout:

```console
$ b6p --json script deploy missing.json
{
  "error": "Config file not found: missing.json",
  "errors": ["Config file not found: missing.json"]
}
```

Note that a command reporting a *value* has still succeeded — `b6p auth status` exits `0` whether
or not a token is stored. Branch on its output, not its exit code:

```bash
b6p --json auth status | jq -e .authenticated >/dev/null
```

> **Changed after 0.9.0.** Failing commands previously exited `0`. If a pipeline was relying on
> `b6p` never failing, it will now correctly go red.

## Unattended use

Every command is usable from a script, but two flags matter:

- `--yes` skips confirmation prompts. If a command needs a value it cannot guess, it now **fails
  immediately** rather than blocking on a prompt no one will answer.
- `--json` writes machine-readable output to stdout and keeps all human text on stderr.

A closed stdin is also an error rather than a hang, so `b6p … < /dev/null` in CI fails fast
instead of stalling until the job times out.

## Authentication

The token from [Signing in](#signing-in) is stored in encrypted secret storage under `~/.b6p/`.
Any command that needs credentials prompts for a token if none is stored, so `b6p auth set` is
optional — but it is the only way to *replace* a token without clearing it first.

For unattended use, check for credentials before running anything that might prompt:

```bash
if [ "$(b6p --json auth status | jq -r .authenticated)" != "true" ]; then
  echo "no b6p token configured" >&2; exit 1
fi
```

Set a token non-interactively by piping it in:

```bash
echo "$B6P_TOKEN" | b6p auth set
```

## WebDAV URL format

```
https://<org>.bluestep.net/files/<id>/draft/
```

When a file has been pulled previously, the WebDAV URL is stored in its
metadata — pass `--file <path>` instead of re-typing the URL.

## Development

```bash
npm install
npm run check-types   # tsc --noEmit
npm run compile       # esbuild → dist/cli.js (self-contained bundle)
npm run watch         # esbuild --watch
npm run test          # bundle test/ → dist-test/ and run node --test
npm run format        # prettier --write
npm run clean         # rm -rf dist dist-test
```

`npm run compile` bundles the CLI and `@bluestep-systems/b6p-core` into a single self-contained
`dist/cli.js` (only Node builtins stay external), which is what the `b6p` binary runs.

## License

MIT
