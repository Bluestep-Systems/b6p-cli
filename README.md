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

`b6p` is organised as `b6p <subsystem> <verb>`. Each top-level name is a part of the
platform; the verbs beneath it act on that part.

### `b6p script` — script trees

| Command | Purpose |
|---|---|
| `b6p script pull <webdav-url>` | Pull a script by URL |
| `b6p script pull --file <path>` | Pull using metadata stored with a local file |
| `b6p script push --file <path>` | Push local files to the platform |
| `b6p script push --file <path> --snapshot --message "…"` | Push and record a versioned snapshot |
| `b6p script audit --file <path>` | Diff local vs. server |
| `b6p script audit --file <path> --pull` | Audit and pull if differences found |
| `b6p script deploy <config.json>` | Multi-target deploy from a config file |
| `b6p script setup --file <path>` | Print the web-UI setup URL for a script |

> **Moved in 0.5.0.** These were previously top-level (`b6p push`, `b6p pull`, …). The old
> spellings still work but are deprecated, warn on use, and **will be removed in 0.6.0** —
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

Most commands accept `--json` for machine-readable output and `--yes` to skip
interactive prompts. Run `b6p <command> --help` for full options.

## Authentication

`b6p` authenticates with a platform **access token**, which begins with `b6pt_`. Set one with:

```bash
b6p auth set
```

The token is stored in encrypted secret storage under `~/.b6p/`. Any command that needs
credentials prompts for a token if none is stored, so `b6p auth set` is optional — but it is
the only way to *replace* a token without clearing it first.

For unattended use, check for credentials before running anything that might prompt:

```bash
if [ "$(b6p --json auth status | jq -r .authenticated)" != "true" ]; then
  echo "no b6p token configured" >&2; exit 1
fi
```

> **Upgrading from 0.4.x?** Authentication changed from a username/password pair to a bearer
> token. The first command you run after upgrading will prompt for your `b6pt_` token, and the
> old credentials are deleted from storage automatically.

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
