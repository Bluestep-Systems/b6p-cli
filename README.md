# @bluestep-systems/b6p-cli

Command-line interface for managing [BlueStep](https://www.bluestep.net/) B6P
scripts: pull components from the platform, push changes back, audit local vs.
server, snapshot history, and deploy across targets.

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

## Commands

| Command | Purpose |
|---|---|
| `b6p pull <webdav-url>` | Pull a script by URL |
| `b6p pull --file <path>` | Pull using metadata stored with a local file |
| `b6p push --file <path>` | Push local files to the platform |
| `b6p push --file <path> --snapshot --message "…"` | Push and record a versioned snapshot |
| `b6p push --file <path> --overwrite <file>` | Push, overwriting a file that changed on the platform |
| `b6p audit --file <path>` | Diff local vs. server |
| `b6p audit --file <path> --pull` | Audit and pull if differences found |
| `b6p deploy <config.json>` | Multi-target deploy from a config file |
| `b6p setup --file <path>` | Print the web-UI setup URL for a script |
| `b6p report` | Report cached state |

Most commands accept `--json` for machine-readable output and `--yes` to answer every question with
its default (and print what it answered). Run `b6p <command> --help` for full options.

## Pushing

A push can ask two questions. Both default to the safe answer, which `--yes` and an empty answer
take, so `--yes` never overwrites or deletes anything on the platform:

1. **Before uploading anything**, when files would overwrite a platform version nobody here has seen
   (it changed on the platform since your last push or pull, or this machine never synced it):
   `[Cancel] / Overwrite all`. Cancel stops the push with nothing uploaded (exit `1`).
2. **After uploading**, when the platform has files your draft doesn't: `[No] / Yes` to delete them.
   No keeps them (exit `0`).

When question 1 is declined, the CLI prints the command that confirms it. After checking the
platform versions (`b6p audit`), confirm specific files up front with `--overwrite`, once per file,
using the path the question listed:

```bash
b6p --yes push --file <path> --snapshot --overwrite scripts/app.ts --overwrite README.md
```

Question 2 has no flag: run without `--yes` and answer `Yes`. Answers can be piped, one line per
question, in order (`printf 'Overwrite all\nYes\n' | b6p push --file <path>`, or `< answers.txt`).

**Exit codes:** `0` when the push went through (keeping platform-only files is still `0`); `1` when
nothing was uploaded, an overwrite was not confirmed, an upload was refused, or, on a snapshot, a
live copy is still wrong after one re-send, the history entry wasn't recorded, or type-check
diagnostics were reported.

**`--json`** prints one object on stdout: `pushed`, `historyRecorded`, `typeCheckDiagnostics`,
`liveVerified`, `liveMismatches`, `keptPlatformOnly`, `declinedOverwrites`. A declined overwrite
prints `pushed: false` with the files in `declinedOverwrites`. Questions, warnings and next steps
go to stderr.

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
