# ADR 0003 — Compile on the server; no compiler in the CLI

**Status:** Accepted
**Date:** 2026-11-09
**Supersedes:** [ADR 0002](0002-typescript-version-strategy.md)

## Context

ADR 0002 pinned `typescript` to 5.9.2 because `b6p-core` compiled TypeScript at runtime: a
`push --snapshot` transpiled `draft/scripts/*.ts` in-process, which needs a compiler that can be
inlined into one `dist/cli.js` and embedded in a standalone binary. TypeScript 7 (the native port)
cannot be, so the CLI stayed on 5.9.2 and carried the lib files, `copy-ts-libs`, and a SEA asset to
match.

The platform now compiles a script's draft itself. After the sources are saved to `draft/`, the client
asks the platform to compile (`compileDraft`), and for a snapshot to publish (`takeSnapshot`, which
recompiles against sibling snapshots and refuses on a save-gate trip, a failed compile or a missing
entry-point output). WebDAV writes never compile. The client sends sources and reads the outcome.

## Decision

1. **Compilation is server-side.** Core 0.9 saves the sources, calls `compileDraft`, and for a
   snapshot calls `takeSnapshot`. The CLI maps the outcomes (compile status, publish refusal reasons,
   request failures) to one error line, an exit code and `--json`, in `src/pushOutcome.ts`.
2. **No client compiler, and none is bundled in the SEA.** `typescript` is a devDependency used to
   build and type-check this repo, nothing more. `copy-ts-libs`, the SEA `ts-libs` asset,
   `typescriptLibDirs` and the lib-set invariant test are gone. TypeScript 7 type-checks this repo
   cleanly; the pin can move when the lockfile is next regenerated.
3. **Servers without server-side compile accept draft saves only.** The CLI (through core) reads the
   server's version before pushing. At or above the minimum, or a `dev` build, a push compiles on the
   platform. Below it, with an unreadable version, or with no minimum known, a plain push saves
   `draft/` and nothing else (exit `0`), and a snapshot push saves `draft/` and then refuses: it prints
   `cannot snapshot, only push saves` and exits `1`. Silently skipping the snapshot would read as success to
   a pipeline; refusing it does not, and the sources are never lost.
4. **The 0.9 standalone binaries ship as a GitHub pre-release** until every server runs a version that
   supports server-side compile. The binary is in wide use, and a 0.9 that can only save drafts must not
   become `releases/latest` for people whose servers cannot snapshot. 0.8.x keeps working against every
   server and stays "latest". `release.yml` marks a listed line (`PRERELEASE_LINES`) pre-release before any
   binary attaches; promoting it is removing the line and `gh release edit <tag> --prerelease=false --latest`.
   The npm package is published normally.

## Alternatives considered

**Bundle a TypeScript 7.1 compiler as a transition fallback** (below the minimum version, compile
locally and upload `.build` and `snapshot/` as before). This was planned and then dropped. TypeScript
7's compiler API drives a per-platform native executable, which cannot be inlined into the CLI bundle;
carrying it meant shipping and extracting it per OS inside the standalone binaries (about 28 MB each),
a way to point core at the extracted copy, a second behaviour for every push outcome and a Windows
path nobody could test. All of that for a window of weeks, to serve servers that are about to be
upgraded anyway, with an old-server push whose output could differ byte-for-byte from the server's. A
draft save plus an honest refusal is simpler and loses nothing.

**Keep TypeScript 5.9.2 in the client.** Rejected: it keeps a second compile path that can disagree
with the platform's, which is the thing server-side compile exists to remove.

## Consequences

- A local type-check before a push no longer exists, and there is no `b6p script check`. The push's
  compile result is the check. A dry-run compile endpoint on the platform would make a `check` verb
  possible; a commented-out stub in `src/commands/script.ts` marks where it goes.
- `--json` loses `typeCheckDiagnostics`, `liveVerified` and `liveMismatches` and gains `route`,
  `snapshotRefused`, `compile`, `publish` and `error`. This is a breaking change for consumers of the
  old fields.
- Until every server is on the minimum, snapshot pushes to older servers need 0.8.x. A user on the
  0.9 pre-release binary who meets `cannot snapshot, only push saves` has found one.
- npm users get 0.9 normally (`npm i -g` works). `b6p check-updates` reads this repository's Releases and
  skips pre-releases, so it does not announce 0.9 to anyone, npm users included.

## Revisit when

Every server runs the minimum version: promote the 0.9 binaries (remove the line from
`PRERELEASE_LINES`), and consider dropping core's draft-only route.
