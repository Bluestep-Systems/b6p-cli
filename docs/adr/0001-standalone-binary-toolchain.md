# ADR 0001 — Standalone binary toolchain

**Status:** Accepted
**Date:** 2026-06-29
**Deciders:** b6p-cli maintainers

## Context

BlueStep needs the `b6p` CLI installable on **internal staff machines** that:

1. **Forbid arbitrary code execution** by security policy — `npm install` is banned because it
   runs arbitrary install scripts across the whole transitive dependency tree.
2. **Often have no Node.js installed.**
3. **Belong to non-terminal users** — staff who do not open a shell.

The delivery model: a staff member opens a Claude Code session, hands it a repo link, and
Claude places a working `b6p` on the machine — no terminal, no npm, no manual build. Admin
control is exercised at the **GitHub Release** level: publishing a Release approves a version;
deleting/yanking it pulls the version. There is **no MDM / machine-level enforcement**.

Today `b6p-cli` ships only as an npm package: esbuild bundles the CLI and
`@bluestep-systems/b6p-core` into a single CJS `dist/cli.js` ([esbuild.js](../../esbuild.js))
that still **requires Node on the target** and is installed via `npm i -g`. Neither works on
the machines above.

We therefore need an **additional** artifact: a self-contained, Node-bundling `b6p` binary for
Windows (x64) and macOS (x64 + arm64), built in CI and attached to each Release. The existing
npm distribution must remain **unchanged** for external users.

A sibling project, `bspecs`, scaffolds Claude Code projects whose skills must call a bare `b6p`
on PATH (no `npx`). That work is gated on this repo producing the binary, against a fixed
contract: binary name `b6p` (`b6p.exe` on Windows), placed in a shared dir
(`%LOCALAPPDATA%\BlueStep\bin\` / `~/.bluestep/bin/`) that the installer puts on PATH.

## Decision

Build the standalone binary with **Node.js SEA (Single Executable Applications) + `postject`**,
on a **per-OS CI matrix** (one runner per target OS/arch). The binary is produced from the
**same** `dist/cli.js` esbuild bundle the npm package ships — no second entry point or build
path. See [scripts/build-sea.mjs](../../scripts/build-sea.mjs) and
[.github/workflows/release.yml](../../.github/workflows/release.yml).

### Rationale

- **Runtime fidelity (the deciding factor).** SEA embeds the **real Node runtime**, so every
  line already exercised on the npm path behaves identically — most importantly
  `CliPrompt.readMasked` ([src/providers/CliPrompt.ts](../../src/providers/CliPrompt.ts)),
  which drives raw-mode TTY stdin (`setRawMode`, the `emitKeypressEvents`/`keypress` decoder
  teardown, `process.kill(pid, "SIGINT")`). This is the credential-masking code from the 0.1.1
  security fix and the single most runtime-fragile path in the CLI. `b6p-core` itself has no
  direct Node API imports — the entire runtime-sensitive surface lives in the CLI's providers —
  so the risk is concentrated here, and we will not re-stake it on a different runtime.
- **No artifact drift.** SEA consumes one CJS blob, exactly what esbuild already emits. The
  binary and the npm package are built from the same source, so they cannot diverge.
- **No new toolchain on the runner.** Node is already provided by `actions/setup-node`;
  `postject` runs via `npx` on the CI runner only — a controlled environment, never the
  locked-down end-user machine — so the npm ban does not apply to it. **No change to
  `package.json` dependencies.**
- **First-party and maintained.** SEA is part of Node core.

## Alternatives considered

- **`bun build --compile`** (close runner-up). One-command cross-compilation from a single
  Linux runner, smaller binaries (~50–60 MB vs ~75–120 MB), trivial arm64. **Rejected** because
  it runs the bundle on **JavaScriptCore, not V8/Node**, and its TTY/raw-mode/`keypress`
  emulation is exactly where the security-relevant masking path is most likely to diverge — a
  regression a CI `--help`/`--version` smoke test would not catch (masking needs interactive
  testing). Build ergonomics did not outweigh runtime fidelity for a security-sensitive CLI.
- **`pkg`** — **rejected**: archived/deprecated, no longer maintained.
- **`nexe`** — **rejected**: lags current Node releases.
- **Clone the public repo and run it locally (with Bun or Node) instead of shipping a binary**
  — **rejected**: a fresh clone has neither `dist/` nor `node_modules` (both gitignored), so
  running it requires `bun install`/`npm install` (the banned arbitrary dependency-tree
  execution) plus installing a runtime on the locked-down machine. It also breaks Release-based
  version control (a clone tracks `master`, not an approved Release) and does not yield a bare
  `b6p` on PATH for the bspecs contract.

## Consequences

- **Per-OS CI matrix.** SEA cannot cross-compile — it injects the blob into a copy of the
  *host* Node binary — so binaries are built on `windows-latest` (x64), `macos-13` (x64), and
  `macos-14` (arm64, native — not Rosetta). arm64 macOS is therefore in scope for v1.
- **Asset naming contract** (stable; the bspecs installer depends on it):
  `b6p-windows-x64.exe`, `b6p-macos-x64`, `b6p-macos-arm64`, each with a `<asset>.sha256`
  sidecar for integrity verification.
- **Mandatory ad-hoc macOS signing.** An unsigned arm64 Mach-O binary is killed by the kernel
  on exec, so `codesign --sign -` (ad-hoc) is required just to make the binary *run*. This is
  distinct from — and not a substitute for — Developer-ID notarization.
- **Code signing / notarization deferred.** Authenticode (Windows) and Developer-ID +
  notarization (macOS) are out of scope here, tracked as a **separate spec**. The
  Claude-as-installer path (agent-fetched file, no Mark-of-the-Web; `xattr -d
  com.apple.quarantine` handled at install time by the bspecs spec) is expected to sidestep the
  worst of SmartScreen/Gatekeeper. **If a clean-machine test proves an unsigned/ad-hoc binary
  cannot be made to run via that path, signing escalates from follow-up to blocker.**
- **Artifact size.** ~75–120 MB per binary → ~250–360 MB per release across three assets.
  GitHub Releases allow up to 2 GB per asset with no practical count limit, so this is well
  within bounds.
- **SEA is experimental** (Node stability 1.1). Mitigated by pinning the build to **Node 22**,
  using only the well-trodden single-CJS path, and a mandatory in-CI smoke test that runs the
  freshly built binary and gates the upload — a broken binary is never attached.
- **npm distribution unchanged.** `publish.yml`, the `dist/cli.js` artifact, the `bin` mapping,
  and the `files` allowlist are untouched; the binary pipeline is purely additive.
