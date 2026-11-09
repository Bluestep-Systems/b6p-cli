# @bluestep-systems/b6p-cli

Headless command-line interface for the [BlueStep](https://www.bluestep.net/) platform.

Script management is the subsystem it covers today — pull components from the platform,
push changes back, audit local vs. server, snapshot history, and deploy across targets —
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

**The 0.9 binaries are a GitHub pre-release.** 0.9 compiles on the platform, which needs a server
version that supports it (see [Pushing](#pushing)); until every organization runs one, the 0.9 Release
is marked pre-release, so `releases/latest` keeps serving 0.8.x, which works against every server. To
use 0.9 now, download it from its Release page by tag. `b6p check-updates` only offers non-pre-release
versions, so it will not suggest 0.9 either.

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
| `b6p script pull <webdav-url>` | Pull a script by URL |
| `b6p script pull --file <path>` | Pull using metadata stored with a local file |
| `b6p script push --file <path>` | Push local files to the platform |
| `b6p script push --file <path> --snapshot --message "…"` | Push and record a versioned snapshot |
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

### What a push does, by server version

A push saves your sources to `draft/`; the **platform** compiles them (the CLI and core bundle no
compiler). `b6p` asks the server for its version first (`--verbose` prints the route it took, `--json`
carries it as `route`):

| Server | `b6p script push` | `b6p script push --snapshot` |
|---|---|---|
| Has server-side compile (or a `dev` build) | sources saved, then the platform compiles the draft | the same, then the platform recompiles and publishes the snapshot |
| Older, unreadable version, or no minimum known | sources saved to `draft/`; nothing compiled (exit `0`) | sources saved, **no snapshot**: prints `cannot snapshot, only push saves` and exits `1` |

The diagnostics, save-gate problems and withheld projects the platform reports are printed on stderr
(capped, with "N more omitted"). A compile that stops at the save gate, withholds its output
(`noEmitOnError`) or does not build leaves your sources saved but the platform's output not updated,
and exits `1`; a compile that finishes with type errors but produced output exits `0` on a plain push.
There is no `b6p script check` (a dry-run compile is waiting on a platform endpoint).

**Exit codes:** `0` when the push went through (keeping platform-only files is still `0`; so is a
plain push to a server without server-side compile); `1` when nothing was uploaded, an overwrite was
not confirmed, an upload was refused, a snapshot was asked of a server that cannot snapshot, the
platform's compile stopped at its save gate, withheld its output or did not build, the platform
refused to publish the snapshot (the error line names the reason and what to do), a compile or
publish request failed (a network failure says to run the push again), or a snapshot published
nothing or has no history entry.

**`--json`** prints one object on stdout: `pushed`, `route`, `snapshotRefused`, `compile`, `publish`,
`historyRecorded`, `keptPlatformOnly`, `declinedOverwrites`, `error`. `error` is `null` on success, else
`{ kind, message }` (the sentence printed on stderr), plus `reason` / `rawReason` for a refused
publish and `networkFailure` / `messages` for a failed request. When core threw instead of
returning, `route` and `compile` are `null` ("not known"). A declined overwrite prints
`pushed: false` with the files in `declinedOverwrites`. Questions, warnings and next steps go to
stderr.

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

> **Changed in 0.9.0.** Failing commands previously exited `0`. If a pipeline was relying on
> `b6p` never failing, it will now correctly go red.

**Known gap:** a multi-target `b6p script deploy` in which some targets fail still exits `0` and
prints "Deploy complete!". Check the log output until this is fixed upstream.

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
