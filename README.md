# @bluestep-systems/b6p-cli

Command-line interface for managing [BlueStep](https://www.bluestep.net/) B6P
scripts: pull components from the platform, push changes back, audit local vs.
server, git history, and deploy across targets.

The CLI shares its core implementation
([`@bluestep-systems/b6p-core`](https://github.com/Bluestep-Systems/b6p-core)) with the
[VS Code extension](https://github.com/Bluestep-Systems/vscode-extension) and can be used standalone in
terminals, CI pipelines, and scripts.

## Installation

This package is published to the public [npm registry](https://www.npmjs.com/), so no authentication is
required to install it.

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

| Command | Purpose |
|---|---|
| `b6p pull <webdav-url>` | Pull a script by URL (clones its git draft) |
| `b6p pull <webdav-url> --enable-git` | Same, and switch a script still on WebDAV to git without asking (one-way) |
| `b6p pull --file <path>` | Pull using metadata stored with a local file |
| `b6p push --file <path>` | Push local files to the platform |
| `b6p push --file <path> --snapshot --message "…"` | Commit the draft with a message and publish it |
| `b6p push --file <path> --author "Jane Doe <jane@example.com>"` | Push as a given commit author |
| `b6p push --file <path> --overwrite <file>` | Push, overwriting a file that changed on the platform |
| `b6p audit --file <path>` | Diff local vs. server |
| `b6p audit --file <path> --pull` | Audit and pull if differences found |
| `b6p deploy <config.json>` | Multi-target deploy from a config file |
| `b6p setup --file <path>` | Print the web-UI setup URL for a script |
| `b6p report` | Report cached state |
| `b6p auth set` | Store or replace your platform access token (`b6pt_…`, see [Signing in](#signing-in)) |

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
platform versions (`b6p audit`), confirm specific files up front with `--overwrite`, once per file,
using the path the question listed:

```bash
b6p --yes push --file <path> --snapshot --overwrite scripts/app.ts --overwrite README.md
```

Question 2 has no flag: run without `--yes` and answer `Yes`. Answers can be piped, one line per
question, in order (`printf 'Overwrite all\nYes\n' | b6p push --file <path>`, or `< answers.txt`;
in PowerShell, `'Overwrite all', 'Yes' | b6p push --file <path>`). The commands the CLI prints are
written for your shell: POSIX, or PowerShell on Windows outside Git Bash.

### Git, authors and switching

A script's draft and its published snapshot are a git repository on the platform; a push commits your
`draft/` folder to it, and `--snapshot` (or `--message`, which implies it) also publishes that
commit. Its history is its git history. Requires a platform with git publishing for scripts (today's
server: its `enableGitPublishing` switch); a script still on WebDAV is switched
to git by its first push or by `b6p pull --enable-git`. **The switch is one-way**: afterwards the
script's draft and snapshot refuse WebDAV writes. The CLI says so when it happens
(`switchedToGit`).

Every commit needs an author. In order, the first complete one is used: `--author "Name <email>"`;
for `deploy`, the config file's `author`; the stored default (`b6p config set author "Name <email>"`);
`git config user.name` and `user.email` for the script folder; then `GIT_AUTHOR_NAME` and
`GIT_AUTHOR_EMAIL` (or the `GIT_COMMITTER_*` pair) in the environment. With none of them the push
stops with exit `1` and prints those fixes; nothing is ever committed as nobody.

`b6p pull` and `b6p push` without `--enable-git` ask before switching a WebDAV script (`[Cancel]` first),
and `--yes` declines, so an unattended run never switches anything and exits `1` (push) with nothing changed.
`--enable-git` works with a URL or with `--file`/the current folder.

Refusals that change nothing and exit `1`: a declined switch, a draft folder with a branch other than
`draft` checked out (push), staged-only changes that a pull would discard, and symbolic links that
would let a pull write outside the draft folder. Each message says how to fix it.

### Exit codes

| Result | Exit |
|---|---|
| Pushed; kept platform-only files, a switch to git, or a read-back that could not run (`liveVerified: null`) are still fine | `0` |
| The user cancelled at the target-URL prompt | `0` |
| Nothing was pushed (`pushed: false`): bad `--root`, empty draft, an overwrite not confirmed, no commit author, an upload refused | `1` |
| Snapshot, and `publishedSha` is `null` (nothing was published) | `1` |
| Snapshot, and `publishError` is set (the platform refused or failed the publish; the draft is still pushed) | `1` |
| Snapshot, and `liveVerified` is `false` (the published branch reads back at another commit) | `1` |
| Snapshot that compiled with type-check diagnostics (`typeCheckDiagnostics > 0`) | `1` |

A plain push (no `--snapshot`) is judged by `pushed` alone.

### `--json`

`--json` prints one object on stdout, the same shape for every outcome (agents parse it):

```json
{
  "pushed": true,
  "commitSha": "3f2a…40 hex characters",
  "publishedSha": "9c1b…40 hex characters",
  "publishError": null,
  "publishRefusal": null,
  "switchedToGit": false,
  "typeCheckDiagnostics": 0,
  "liveVerified": true,
  "liveMismatches": [],
  "keptPlatformOnly": [],
  "declinedOverwrites": []
}
```

- `commitSha`: the draft branch's head after the push (the commit this push made, or the one already
  there); `null` when `pushed` is false.
- `publishedSha`: the commit the platform published; `null` on a plain push, an aborted push or a
  failed publish.
- `publishError`: why the publish failed, else `null`.
- `publishRefusal`: `{ "reason", "withheld" }`, straight from the platform, when it refused the publish. For
  a build that is missing, unreadable or older than its sources (`BUILD_MANIFEST_MISSING`,
  `BUILD_MANIFEST_INVALID`, `BUILD_STALE`) `withheld` lists the stale files or the manifest's path: rebuild
  and push. The draft is pushed, the published script unchanged, and the exit code is `1`. Else `null`.
- `switchedToGit`: this push moved the script from WebDAV to git.
- `historyRecorded` is gone (0.9.0): history is the git history, so `commitSha` and `publishedSha`
  replace it.
- A declined overwrite prints `pushed: false` with the files in `declinedOverwrites`; a missing
  author prints `pushed: false` too (the reason is on stderr); a cancelled target-URL prompt prints
  `{ "cancelled": true }`. Questions, warnings and next steps go to stderr.

### Deploy

`b6p deploy <config.json>` pushes the source draft to each target:

```json
{
  "sourceRootPath": "./my-script",
  "targets": [{ "url": "https://…/files/123/draft/", "snapshot": true }],
  "author": { "name": "Jane Doe", "email": "jane@example.com" },
  "message": "Deploy from CI",
  "externallyBuilt": false
}
```

`externallyBuilt: true` is for scripts a bundler outside b6p builds (no build manifest is written and the
platform skips its stale-build check); `b6p push --externally-built` is the same for a push. `author` (an object, or `"Jane Doe <jane@example.com>"`) and `message` are optional and apply to every
target; `b6p deploy --author "…"` overrides the file's author. `deploy` exits `1` if no author resolves
(nothing is pushed then) or if any target failed or its publish was refused.

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
npm run format        # prettier --write
npm run clean         # rm -rf dist
```

`npm run compile` bundles the CLI and `@bluestep-systems/b6p-core` into a single self-contained
`dist/cli.js` (only Node builtins stay external), which is what the `b6p` binary runs.

## License

MIT
