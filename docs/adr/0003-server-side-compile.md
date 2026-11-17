# ADR 0003 — The platform builds every push; no compiler in the CLI

**Status:** Accepted (revised 2026-11-16 for b6p-core 1.0 and CLI 1.0.0)
**Date:** 2026-11-09
**Supersedes:** [ADR 0002](0002-typescript-version-strategy.md)

## Context

ADR 0002 pinned `typescript` to 5.9.2 because `b6p-core` compiled TypeScript at runtime: a
`push --snapshot` transpiled `draft/scripts/*.ts` in-process, which needs a compiler that can be
inlined into one `dist/cli.js` and embedded in a standalone binary. TypeScript 7 (the native port)
cannot be, so the CLI stayed on 5.9.2 and carried the lib files, `copy-ts-libs`, and a SEA asset to
match.

Since b6p-core 0.9.0 a script's draft is a git repository, and since b6p-core 1.0.0 the platform builds it: a
push commits the draft and pushes it over git, then asks the platform to build that commit (`compileDraft` with
`expectedDraftSha`). The platform compiles the draft branch and commits the output (and the build manifest, when it
vouches for a clean build) as one build commit; core moves the local draft folder to it, and a snapshot push
publishes it.

## Decision

1. **Compilation is server-side, on every push.** The CLI maps core's push result (the route, a refused snapshot,
   the build's status, a blocked move to the build commit, the publish) to one verdict in `src/pushOutcome.ts`
   (`pushProblem`): the exit code, the error line, `--json`'s `error`, and a "To go on" line naming the command.
   Core says what happened; the CLI says how to respond.
2. **No compiler in the CLI, and none in the SEA.** `typescript` (exact 7.0.2) is a devDependency used to
   type-check this repo, nothing more; esbuild never bundles it, and `test/noCompiler.test.ts` checks the bundle.
   `copy-ts-libs`, the SEA `ts-libs` asset, `typescriptLibDirs` and the lib-set invariant test are gone.
3. **Servers without the git build accept the push alone.** Core reads the server's version before pushing. At or
   above core's `MIN_SERVER_VERSION`, or a `dev`/`latest` build, the platform builds the push. Otherwise a plain
   push is the git push alone (exit `0`), and a snapshot push pushes the draft and then refuses: it prints
   `cannot snapshot, only push saves` and exits `1`. Silently skipping the snapshot would read as success to a
   pipeline; refusing it does not, and the sources are never lost.
4. **`--externally-built` is gone.** The platform reads each script's own `externallyBuilt` flag; the CLI flag is
   an unknown option, and an `externallyBuilt` key in a deploy config is refused by name.
5. **CLI 1.0.0 ships as a normal release, standalone binaries included** (ruling 71, superseding the 0.9
   pre-release plan): `release.yml` has no pre-release lines.

## Alternatives considered

**Bundle a TypeScript compiler as a transition fallback** (compile locally below the minimum version). Dropped:
TypeScript 7's compiler API drives a per-platform native executable, which cannot be inlined into the CLI bundle,
and a second compile path can disagree with the platform's.

**Keep TypeScript 5.9.2 in the client.** Rejected for the same reason: it is the second compile path server-side
builds exist to remove.

## Consequences

- There is no local type-check before a push and no `b6p script check`. The push's build result is the check. A
  dry-run compile endpoint on the platform would make a `check` verb possible; a commented-out stub in
  `src/commands/script.ts` marks where it goes.
- `--json` is core 1.0's `PushResult` (with `route`, `snapshotRefused`, `build`, `buildCommitSha`, `buildVouched`,
  `buildError`, `buildErrorKind`, `buildErrorReason`, `buildIncomplete`, `buildFastForward`) plus `declinedOverwrites` and `error`.
  `typeCheckDiagnostics` is the platform's whole ERROR + WARNING count; `typeCheckErrors` lists those in the
  script's own sources.
- A snapshot push against a server below the floor fails until that server is upgraded.

## Revisit when

Every server runs the minimum version: consider dropping core's push-only route.
