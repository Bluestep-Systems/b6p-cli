# Quick task: Windows ILockDiagnoser for the CLI

**Type:** small change (new feature)
**Component:** `b6p-cli` (not a BlueStep platform component — CLI/TS infrastructure)
**Status:** done — all items landed and verified (see Verification)

## Summary

Implement and wire a Windows `ILockDiagnoser` so that when a shared-state write
(`~/.b6p/state.json`, `secrets.enc`) fails a rename on Windows, the thrown error names the
user-mode processes holding the file (e.g. `… — locked by Code.exe (1234), OneDrive.exe (5678)`).
Core (`@bluestep-systems/b6p-core` 0.4.0) added the injectable diagnoser; the OS-specific
implementation lives here in the CLI.

## Approach

All items are `[CODE]` — no BlueStep platform ops involved.

**Done:**

- [x] [CODE] Bump `@bluestep-systems/b6p-core` `^0.3.1` → `^0.4.0` in `package.json` and install
      (verified `ILockDiagnoser`/`LockHolder` export). Install had to run **inside WSL** —
      `npm install` over the `\\wsl.localhost` UNC path corrupted `node_modules`; repaired.
- [x] [CODE] `src/lockDiagnoser/WindowsRestartManagerLockDiagnoser.ts` — implements `ILockDiagnoser`.
      Non-Windows → `[]` immediately. On Windows, spawns PowerShell (bundled as a `String.raw`
      literal, passed via `-EncodedCommand`; target path via `B6P_LOCK_TARGET` env var, never
      interpolated) that P/Invokes the Restart Manager (`RmStartSession` → `RmRegisterResources`
      → `RmGetList` → `RmEndSession`) and prints JSON `{name, pid}[]`. Internal 1.5s
      `AbortController` timeout (under core's 2s outer race). Wrapped in try/catch — never throws,
      returns `[]` on any error/timeout/empty. Empty result on a still-failed write is the
      expected minifilter fingerprint (Sophos CryptoGuard etc.) — core turns it into its hint.
- [x] [CODE] Wire in at `src/index.ts:40`:
      `new SharedFilePersistence(undefined, new WindowsRestartManagerLockDiagnoser())`
      (first arg `undefined` keeps the default `~/.b6p` config dir).
- [x] [CODE] No `any` — used `unknown` + narrowing in `parseHolders`.
- [x] Verified: `check-types`, `lint`, `compile`, `node dist/cli.js --help` smoke all green.

**Landed after decisions:**

- [x] [CODE] **Test runner — esbuild the test (option A).** Test authored in TS under `test/`;
      `esbuild.test.js` bundles `test/**/*.test.ts` → `dist-test/*.test.cjs`; `npm test` runs
      `node --test dist-test/`. Runs on WSL Node 20 and the CI 18/20/22 matrix (compiled `.cjs`, no
      type-stripping, no new dependency). 5/5 tests pass. `dist-test/` gitignored; `clean` updated.
- [x] [CODE] **Doc sync:** `@lastreviewed null` added to every JSDoc block in the diagnoser;
      CHANGELOG `[0.4.0]` entry added; CLAUDE.md updated (dev-commands + `test/` note + a
      lockDiagnoser paragraph in the architecture section).
- [x] [CODE] **CI + version:** added a "Unit tests" step to `.github/workflows/ci.yml` between
      compile and smoke; bumped `package.json` version `0.3.1` → `0.4.0` with a matching CHANGELOG
      release entry. `publish.yml` / `bin` / `files` left untouched (per AGENTS.md).

## Notes

### Review findings (what "make sure we didn't miss anything" caught)

1. **Test approach doesn't fit this repo.** I first wrote a `.ts` test run via `node --test`
   relying on Node's type-stripping. That breaks on WSL's Node 20. The established convention in
   the sibling package `b6p-core` is: dependency-free `.js` tests under `test/`, `require`-ing the
   **compiled** class from `dist/`, run with `node test/*.test.js` after `npm run compile`. But the
   CLI produces a **single esbuild bundle** (`dist/cli.js`) — there are no per-module `dist/*.js`
   to require. So neither core's pattern nor the `.ts` pattern drops in cleanly. Options:
   - **(A) Mirror core, esbuild the test:** author `test/*.test.js` (CJS, `node:test`), add a tiny
     esbuild step to emit the diagnoser (or the test) to a gitignored `dist-test/`, run with plain
     `node`. Zero new deps, matches the CLI's "esbuild is the compiler" ethos. *(recommended)*
   - **(B) Emit via tsc:** a `tsconfig.test.json` emitting CJS to `dist-test/`, then `node --test`.
     Contradicts CLAUDE.md's "esbuild produces the artifact, not tsc" slightly.
   - **(C) Add `tsx` devDependency** and run `.ts` directly. Simplest to write; diverges from core
     (which deliberately has zero test deps) and adds a dependency.
2. **`@lastreviewed null` missing.** AGENTS.md makes it a MUST on all AI-written JSDoc; the new file
   has none yet.
3. **CHANGELOG not updated.** AGENTS.md: any user-visible change gets an entry. The improved error
   message is user-visible. No `[Unreleased]` section exists — need to add one (Keep a Changelog).
4. **CLAUDE.md drift.** Its "Common Development Commands" omits a `test` script; its architecture
   section lists `src/providers/` but not the new `src/lockDiagnoser/`.
5. **CI doesn't run tests.** Adding a test that CI never executes lets it rot. Consider a step in
   `.github/workflows/ci.yml` (fair game — unlike `publish.yml`, which AGENTS.md says leave alone).
6. **`.gitignore`.** If tests emit to `dist-test/`, add it (currently only `dist/` is ignored). Done.
7. **CRLF hazard.** Editing these WSL files from the Windows-side tools flipped some files
   (`src/index.ts`, `CLAUDE.md`, `.gitignore`) to CRLF while the repo is LF — a whole-file diff.
   Normalized all back to LF; confirmed clean minimal diffs. Watch for this on future edits.

## Verification

- `check-types`, `lint`, `compile`, `node dist/cli.js --help` smoke: all green (run in WSL).
- `npm test`: 5/5 pass on WSL Node 20 (the CI matrix floor).
- `format-check`: my files clean; only pre-existing `src/tsLibs.ts` drift remains (unrelated; CI
  does not run format-check). Not fixed here to keep the diff scoped.
- Manual Windows check (real Restart Manager, via the diagnoser's exact `-EncodedCommand` transport):
  - File held open by a separate process → `[{"name":"powershell.exe","pid":31532}]` (names holder + pid).
  - Unlocked file → `[]` — the same empty result a kernel minifilter (Sophos CryptoGuard) yields, which
    core turns into its minifilter hint. Could not summon Sophos itself, but the empty-list code path
    it exercises is the one validated here.
  - Could not manufacture a real `rename`-EPERM (needs a live lock mid-rename); core's own
    `SharedFilePersistence.test.js` already covers `buildRenameError`/`diagnoseSafely` wiring.
