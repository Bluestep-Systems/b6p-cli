# @bluestep-systems/b6p-cli

Command-line interface for managing [BlueStep](https://www.bluestep.net/) B6P
scripts: pull components from the platform, push changes back, audit local vs.
server, snapshot history, and deploy across targets.

The CLI shares its core implementation with the
[`bsjs-push-pull` VS Code extension](https://github.com/bluestep-systems/vscode-extension)
and can be used standalone in terminals, CI pipelines, and scripts.

## Installation

This package is published to [GitHub Packages](https://docs.github.com/en/packages),
not the public npm registry. You need a GitHub personal access token (PAT) with
`read:packages` scope to install it, and `write:packages` to publish.

1. Create a `.npmrc` in your home directory or project (do **not** commit it):

   ```ini
   @bluestep-systems:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
   ```

2. Install globally:

   ```bash
   npm install -g @bluestep-systems/b6p-cli
   ```

3. Verify:

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

## License

MIT — see [LICENSE](https://github.com/bluestep-systems/vscode-extension/blob/master/LICENSE).
