# ADR 0002 — TypeScript version strategy: stay on 5.9.2 until the compiler can run in-process

Status: accepted (2026-08-21). Supersedes the TypeScript 7 upgrade that shipped in `b6p-cli` 0.6.0
and `b6p-core` 0.6.0.

## Context

`@bluestep-systems/b6p-core` **compiles TypeScript at runtime**. A `b6p push --snapshot` transpiles the
component's `draft/scripts/*.ts` in-process through `ScriptTranspiler`, which calls the compiler as a
library — `createProgram`, `transpileModule`, `parseJsonConfigFileContent`, `sys` — and reads real
`lib.*.d.ts` files off disk through `TsLibResolver`. That is not a build-time concern that can be
swapped freely; it is a runtime dependency of a shipped feature.

`b6p-cli` bundles core into a single self-contained `dist/cli.js` (esbuild, everything but Node
builtins inlined), and `scripts/build-sea.mjs` wraps that same bundle into standalone Node SEA binaries
for machines with no Node or npm — see [ADR 0001](0001-standalone-binary-toolchain.md). The compiler
therefore has to survive being inlined into one JavaScript file and embedded in an executable.

TypeScript 7 is the native Go port, and it does not fit those constraints. Measured against the
published packages:

| | `lib.*.d.ts` shipped | package size | classic in-process API |
|---|---|---|---|
| 5.9.2 | 99 | 23 MB | complete |
| 6.0.0-beta | 107 | 24 MB | complete |
| **7.0.2** | **0** | 3.6 MB | **`createProgram`, `transpileModule`, `parseJsonConfigFileContent`, `sys` all absent** |

In 7.0.2 the `typescript` entry point is only a version stub. The replacement API
(`typescript/unstable/sync`) talks JSON-RPC to a per-platform native executable, delivered as 20
optional dependencies (`@typescript/typescript-linux-x64`, `-win32-x64`, `-darwin-arm64`, …) and located
at runtime by `lib/getExePath.js`. A native sidecar binary cannot be inlined into `dist/cli.js`, and
putting it inside a SEA is a distribution problem in its own right rather than a dependency swap. TS 7
also ships no lib files at all, because the Go port embeds them — so a compiler that needs them on disk
has nothing to read.

An earlier revision (`b6p-cli` #15) resolved this by installing TypeScript **twice**: core kept
`typescript` 5.9.2 as an exact-pinned runtime dependency to do the actual compiling, and both repos
added `typescript-7` (`npm:typescript@7.0.2`) purely to type-check. That worked, and it bought
type-check speed, but it made the split permanent and the split is what shaped the code:

- core needed a `tsc7` script calling the compiler by explicit path, because both packages declared a
  `tsc` bin and `node_modules/.bin/tsc` went to the 5.9 copy;
- npm could not dedupe the two, so `node_modules/@bluestep-systems/b6p-core/node_modules/typescript`
  was expected and load-bearing;
- `esbuild.js`'s `copy-ts-libs` had to resolve `typescript` from **core's** directory rather than the
  repo root, so the `lib.*.d.ts` shipped into `dist/lib/` matched the compiler that reads them at
  runtime. Root-resolving instead looked like a harmless tidy-up and failed only by accident — TS 7
  ships zero libs, so the lookup threw. Once core moved to TS 7 that accident would have disappeared
  and a mismatched lib set would have shipped silently, breaking `push --snapshot` for users while
  every build stayed green.

Runtime compilation on TypeScript 7 is not expected to be viable before 7.1 at the earliest.

## Decision

**Pin `typescript` to exactly `5.9.2` in both repos, as the single compiler for build, type-check and
runtime.** Remove the `typescript-7` alias and the `tsc7` indirection; `compile`, `watch` and
`check-types` call `tsc` directly.

**Keep the migration scaffolding.** It is version-agnostic, costs nothing on 5.9, and is exactly what a
future upgrade needs:

- `types: ["node"]` stays in `tsconfig.base.json`. TS 7 required it (it no longer pulls every
  `node_modules/@types` package into global scope); on 5.9 it is simply a narrower, more explicit
  global scope. Verified: both repos type-check clean with it in place on 5.9.2.
- `copy-ts-libs` keeps resolving `typescript` from **core's** directory. This matters *more* after the
  rollback, not less — see Consequences.
- The lib-set invariant test (`test/typescriptLibs.test.ts`, arriving with the noun-first command tree)
  stays. It is the only thing that turns a silent lib mismatch into a red build.

## Alternatives considered

**Stay on TypeScript 7.** Rejected. It cannot compile in-process, so it cannot ever become the runtime
compiler — meaning the two-compiler split would be permanent rather than transitional, and every
consequence above would be a fixture of the codebase instead of a temporary cost.

**Roll back to TypeScript 6.0 instead of 5.9.2.** Rejected, for three reasons. There is **no stable
6.x** — npm carries only `6.0.0-beta` plus nightlies, with `latest` at 7.0.2 — so this would put a
prerelease in CI. It would keep two compilers, because core's runtime pin would stay at 5.9.2. And its
lib set is **107** files against that runtime's **99**, which re-arms precisely the silent-mismatch
hazard described above. The one thing 6.0 offers that 5.9.2 does not is the deprecation-warning bridge
toward 7, which is worth revisiting when a forward move is actually on the table.

**Keep 7 for type-checking only, and drop runtime compilation.** Not viable: transpiling a snapshot
push is a shipped feature, and the platform does not recompile `draft/scripts/*.ts` server-side.

## Consequences

- **Loses native-port type-check speed.** At this codebase's size that is seconds, and `check-types`
  is not on a hot path.
- **No source changes.** Verified up front that both repos type-check with zero errors on 5.9.2,
  6.0.0-beta and 7.0.2, so this is a toolchain change only.
- **core's published `dist/` is now emitted by 5.9.2.** Its suite runs against `dist/`, so the emit
  change is covered by the existing specs.
- **One compiler in the dependency tree.** With the root pinned to the same exact version core
  requires, npm dedupes: the nested
  `node_modules/@bluestep-systems/b6p-core/node_modules/typescript` is gone. `copy-ts-libs` resolving
  from core's directory now finds the same 5.9.2 the root has, so the shipped lib set matches by
  construction — verified: 99 `lib.*.d.ts` in `dist/lib/`, and `dist/cli.js` embeds `5.9.2` with no
  trace of `7.0.2`.
- **A lib mismatch is now silent rather than loud, so the guard rails matter.** On TS 7 a root-resolved
  lookup failed immediately with zero files found. On 5.9/6.0 the same mistake succeeds and ships
  whatever libs it happened to find. Unifying on one exact version makes the mismatch structurally
  impossible today, but the resolve-from-core logic and the invariant test are what keep it impossible
  if the versions ever diverge again.
- **`@typescript-eslint`'s `typescript >=4.8.4 <6.1.0` peer becomes satisfiable again.** ESLint was
  removed from `b6p-cli` *because* TS 7 broke that peer, which un-enforced the project's no-`any` rule
  (`noImplicitAny` still catches the implicit case; an explicit `any` compiles silently). Restoring it
  is now possible and is deliberately **out of scope here** — it was an explicitly deferred decision.
  Note core's own linter removal was unrelated (its rules were all `warn` and gated nothing) and should
  not be undone.

## Revisit when

A TypeScript release can **compile in-process** — that is, exposes a programmatic compiler API usable
from a bundled single-file CJS artifact without spawning a per-platform native binary. That is the one
condition that lets `ScriptTranspiler` move off 5.9.2 and collapses this decision.

If instead the API stays out-of-process, the question is not "which TypeScript" but "can a native
compiler binary ship inside the npm tarball and the SEA" — a distribution question for ADR 0001's
territory, and a materially larger change than a version bump. Settle that before treating a 7.x move
as available.
