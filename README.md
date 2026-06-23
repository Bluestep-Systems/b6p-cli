# @bluestep-systems/b6p-cli

Command-line interface for managing [BlueStep](https://www.bluestep.net/) B6P
scripts: pull components from the platform, push changes back, audit local vs.
server, snapshot history, and deploy across targets.

The CLI shares its core implementation
([`@bluestep-systems/b6p-core`](https://github.com/Bluestep-Systems/b6p-core)) with the
[VS Code extension](https://github.com/Bluestep-Systems/b6p-vscode) and can be used standalone in
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

## Commands

| Command | Purpose |
|---|---|
| `b6p pull <webdav-url>` | Pull a script by URL |
| `b6p pull --file <path>` | Pull using metadata stored with a local file |
| `b6p push --file <path>` | Push local files to the platform |
| `b6p push --file <path> --snapshot --message "…"` | Push and record a versioned snapshot |
| `b6p audit --file <path>` | Diff local vs. server |
| `b6p audit --file <path> --pull` | Audit and pull if differences found |
| `b6p deploy <config.json>` | Multi-target deploy from a config file |
| `b6p setup --file <path>` | Print the web-UI setup URL for a script |
| `b6p report` | Report cached state |

Most commands accept `--json` for machine-readable output and `--yes` to skip
interactive prompts. Run `b6p <command> --help` for full options.

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
npm run lint          # eslint
npm run compile       # esbuild → dist/cli.js (self-contained bundle)
npm run watch         # esbuild --watch
npm run format        # prettier --write
npm run clean         # rm -rf dist
```

`npm run compile` bundles the CLI and `@bluestep-systems/b6p-core` into a single self-contained
`dist/cli.js` (only Node builtins stay external), which is what the `b6p` binary runs.

## License

MIT
