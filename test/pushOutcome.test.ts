// The push verdict, exit rule and --json body on core 1.0 (the platform builds every git push).
//
// pushProblem is the one rule behind the exit code, the CLI's error line and --json's `error`. This table is what
// keeps a refactor from dropping a signal.
import { describe, it } from "node:test";
import assert from "node:assert";
import { bsjsGit, type PushResult } from "@bluestep-systems/b6p-core";
import {
  declinedPushJson,
  canonicalPushArgs,
  deleteCommand,
  describePush,
  detectShellDialect,
  overwriteCommand,
  pushAdvice,
  pushExitCode,
  pushProblem,
  routeVerboseLines,
  shellQuote,
  SNAPSHOT_REFUSED_LINE,
  toPushJson,
} from "../src/pushOutcome";

const SHA_DRAFT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_BUILD = "cccccccccccccccccccccccccccccccccccccccc";
const SHA_PUBLISHED = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** A clean, built snapshot push; each case overrides what it tests. */
function result(overrides: Partial<PushResult> = {}): PushResult {
  return {
    pushed: true,
    commitSha: SHA_DRAFT,
    publishedSha: SHA_PUBLISHED,
    publishError: null,
    publishRefusal: null,
    switchedToGit: false,
    route: { mode: "server-build", reason: "at-or-above-floor", serverVersion: "26.12.01.00", required: "26.12.01.00" },
    snapshotRefused: null,
    build: null,
    buildCommitSha: SHA_BUILD,
    buildVouched: true,
    buildError: null,
    buildErrorKind: null,
    buildIncomplete: null,
    buildFastForward: { state: "fast-forwarded", blockedPaths: [], error: null },
    typeCheckDiagnostics: 0,
    typeCheckErrors: [],
    liveVerified: true,
    liveMismatches: [],
    keptPlatformOnly: [],
    ...overrides,
  };
}

const kind = (r: PushResult, snapshot: boolean, failOnTypeErrors = false) =>
  pushProblem(r, snapshot, failOnTypeErrors)?.kind ?? null;

const TYPE_ERROR = { file: "scripts/app.ts", line: 3, column: 7, code: 2322, message: "x", severity: "WARNING" };

describe("pushProblem / pushExitCode", () => {
  it("a clean built snapshot, and a clean plain push, succeed", () => {
    assert.strictEqual(kind(result(), true), null);
    assert.strictEqual(pushExitCode(result(), true), 0);
    assert.strictEqual(pushExitCode(result({ publishedSha: null, liveVerified: null }), false), 0);
  });

  it("a cancelled target-URL prompt (null) is 0", () => {
    assert.strictEqual(pushExitCode(null, true), 0);
    assert.strictEqual(pushExitCode(null, false), 0);
  });

  it("nothing pushed fails, plain or snapshot", () => {
    assert.strictEqual(kind(result({ pushed: false }), false), "NOTHING_PUSHED");
    assert.strictEqual(pushExitCode(result({ pushed: false }), true), 1);
  });

  it("a snapshot the server cannot take fails with the pinned line (ruling 46)", () => {
    const refused = result({
      publishedSha: null,
      route: { mode: "push-only", reason: "below-floor", serverVersion: "26.11.01.00", required: "26.12.01.00" },
      snapshotRefused: { reason: "too-old", serverVersion: "26.11.01.00", required: "26.12.01.00" },
      build: null,
      buildCommitSha: null,
      buildVouched: null,
      buildFastForward: null,
    });
    const p = pushProblem(refused, true);
    assert.strictEqual(p?.kind, "SNAPSHOT_REFUSED");
    assert.strictEqual(p?.message, "cannot snapshot, only push saves");
    assert.strictEqual(SNAPSHOT_REFUSED_LINE, "cannot snapshot, only push saves");
    assert.match(p?.howTo ?? "", /26\.12\.01\.00/);
  });

  it("a plain push to a server without the git build succeeds (push-only route)", () => {
    const old = result({
      publishedSha: null,
      liveVerified: null,
      route: { mode: "push-only", reason: "below-floor", serverVersion: "26.11.01.00", required: "26.12.01.00" },
      buildCommitSha: null,
      buildVouched: null,
      buildFastForward: null,
    });
    assert.strictEqual(pushExitCode(old, false), 0);
  });

  it("a build that was not asked for says pull, then push; a failed request says push again", () => {
    const notAsked = pushProblem(result({ buildError: "draft moved", buildErrorKind: "not-requested" }), false);
    assert.strictEqual(notAsked?.kind, "BUILD_NOT_REQUESTED");
    assert.match(notAsked?.howTo ?? "", /b6p script pull/);
    const failed = pushProblem(result({ buildError: "500", buildErrorKind: "request-failed" }), false);
    assert.strictEqual(failed?.kind, "BUILD_REQUEST_FAILED");
    assert.match(failed?.howTo ?? "", /b6p script push/);
  });

  it("an unknown build outcome says pull, then push (ruling 71); an unknown status says update b6p", () => {
    const unknownOutcome = pushProblem(
      result({
        buildIncomplete: {
          status: "UNKNOWN",
          rawStatus: bsjsGit.BUILD_OUTCOME_UNKNOWN_REASON,
          description: "the platform could not tell whether its build landed",
        },
      }),
      false
    );
    assert.strictEqual(unknownOutcome?.kind, "BUILD_OUTCOME_UNKNOWN");
    assert.match(unknownOutcome?.howTo ?? "", /b6p script pull`, then `b6p script push/);
    assert.doesNotMatch(unknownOutcome?.howTo ?? "", /Update b6p/);
    const unknownStatus = pushProblem(
      result({ buildIncomplete: { status: "UNKNOWN", rawStatus: "NEW_THING", description: "unknown status" } }),
      false
    );
    assert.strictEqual(unknownStatus?.kind, "BUILD_INCOMPLETE");
    assert.match(unknownStatus?.howTo ?? "", /Update b6p/);
  });

  it("a build status that does not publish fails a plain push too, with a status-specific how-to", () => {
    const busy = pushProblem(result({ buildIncomplete: { status: "BUSY", rawStatus: "BUSY", description: "busy" } }), false);
    assert.strictEqual(busy?.kind, "BUILD_INCOMPLETE");
    assert.match(busy?.howTo ?? "", /again in a minute/);
    const gate = pushProblem(
      result({ buildIncomplete: { status: "GATE_TRIPPED", rawStatus: "GATE_TRIPPED", description: "gate" } }),
      false
    );
    assert.match(gate?.howTo ?? "", /save-gate/);
  });

  it("local files in the way of the build fail, and name the files and the next push", () => {
    const blocked = pushProblem(
      result({ buildFastForward: { state: "blocked", blockedPaths: ["dist/app.js"], error: null } }),
      false
    );
    assert.strictEqual(blocked?.kind, "BUILD_BLOCKED");
    assert.match(blocked?.howTo ?? "", /dist\/app\.js/);
    assert.match(blocked?.howTo ?? "", /b6p script push/);
    const failed = pushProblem(result({ buildFastForward: { state: "failed", blockedPaths: [], error: "boom" } }), false);
    assert.strictEqual(failed?.kind, "BUILD_TAKE_IN_FAILED");
    assert.strictEqual(kind(result({ buildFastForward: { state: "unchanged", blockedPaths: [], error: null } }), true), null);
  });

  it("a snapshot that was refused, failed, published nothing or reads back wrong fails", () => {
    assert.strictEqual(
      kind(
        result({
          publishedSha: null,
          publishError: "refused",
          publishRefusal: { reason: "BUILD_STALE", withheld: ["scripts/app.ts"] },
        }),
        true
      ),
      "PUBLISH_REFUSED"
    );
    assert.strictEqual(kind(result({ publishedSha: null, publishError: "500" }), true), "PUBLISH_FAILED");
    assert.strictEqual(kind(result({ publishedSha: null }), true), "NOT_PUBLISHED");
    assert.strictEqual(kind(result({ liveVerified: false }), true), "LIVE_MISMATCH");
    assert.strictEqual(kind(result({ liveVerified: null }), true), null);
  });

  it("publish fields are ignored on a plain push", () => {
    assert.strictEqual(kind(result({ publishedSha: null, publishError: "x", liveVerified: false }), false), null);
  });

  it("an unclean plain push succeeds (ruling 62) and advises how to make it publishable", () => {
    const unclean = result({ publishedSha: null, liveVerified: null, buildVouched: false, typeCheckDiagnostics: 1 });
    assert.strictEqual(pushExitCode(unclean, false), 0);
    assert.match(pushAdvice(unclean) ?? "", /snapshot is refused/);
    assert.strictEqual(pushAdvice(result()), null);
  });

  it("diagnostics in the script's own sources warn, unless --fail-on-type-errors", () => {
    const r = result({ typeCheckDiagnostics: 3, typeCheckErrors: [TYPE_ERROR] });
    assert.strictEqual(pushExitCode(r, true), 0);
    assert.strictEqual(kind(r, true, true), "TYPE_ERRORS");
    // Diagnostics only outside the script's own sources (a .d.ts) never count.
    assert.strictEqual(kind(result({ typeCheckDiagnostics: 2, typeCheckErrors: [] }), true, true), null);
  });

  it("kept platform-only files and a switch to git are still success", () => {
    assert.strictEqual(pushExitCode(result({ keptPlatformOnly: ["scripts/old.ts"] }), true), 0);
    assert.strictEqual(pushExitCode(result({ switchedToGit: true }), true), 0);
  });
});

describe("describePush", () => {
  it("prints the commit ids", () => {
    const lines = describePush(result(), true);
    assert.deepStrictEqual(lines.info, [
      `Draft commit: ${SHA_DRAFT}`,
      `Build commit: ${SHA_BUILD}`,
      `Published commit: ${SHA_PUBLISHED}`,
    ]);
    assert.deepStrictEqual(lines.notices, []);
  });

  it("adds one 'To go on' notice for a failed push, and the git switch loudly", () => {
    const lines = describePush(result({ publishedSha: null, switchedToGit: true }), true);
    assert.strictEqual(lines.notices.length, 2);
    assert.match(lines.notices[0], /^To go on: Run `b6p script push --snapshot` again/);
    assert.match(lines.notices[1], /switched from WebDAV to git/);
  });
});

describe("routeVerboseLines", () => {
  it("names the route and the versions, and nothing when no route was taken", () => {
    assert.match(routeVerboseLines(result())[0], /^Push route: server-build \(at-or-above-floor; server version 26\.12\.01\.00/);
    assert.deepStrictEqual(routeVerboseLines(result({ route: null })), []);
  });
});

describe("toPushJson", () => {
  it("is core's result plus declinedOverwrites and the verdict", () => {
    const r = result();
    assert.deepStrictEqual(toPushJson(r, true), { ...r, declinedOverwrites: [], error: null });
    const failed = toPushJson(result({ publishedSha: null }), true);
    assert.strictEqual(failed.error?.kind, "NOT_PUBLISHED");
    assert.ok(failed.error?.howTo);
  });

  it("carries the core 1.0 build fields and no historyRecorded", () => {
    const json = toPushJson(result(), true) as Record<string, unknown>;
    for (const key of ["route", "snapshotRefused", "build", "buildCommitSha", "buildVouched", "buildError", "buildErrorKind", "buildIncomplete", "buildFastForward"]) {
      assert.ok(key in json, key);
    }
    assert.ok(!("historyRecorded" in json));
  });
});

describe("declinedPushJson", () => {
  it("reads as did-not-run, with the files and the verdict, and never as success", () => {
    const json = declinedPushJson(
      { kind: "OVERWRITE_DECLINED", message: "declined", howTo: "overwrite them" },
      ["scripts/app.ts", "README.md"]
    );
    assert.strictEqual(json.pushed, false);
    assert.deepStrictEqual(json.declinedOverwrites, ["scripts/app.ts", "README.md"]);
    assert.strictEqual(json.error?.kind, "OVERWRITE_DECLINED");
    assert.strictEqual(json.buildFastForward, null);
    assert.strictEqual(pushExitCode(json, true), 1, "the same body must never read as success");
  });

  it("has exactly the keys of a normal push's JSON", () => {
    const declined = declinedPushJson({ kind: "NO_AUTHOR", message: "x", howTo: null });
    assert.deepStrictEqual(Object.keys(declined).sort(), Object.keys(toPushJson(result(), true)).sort());
  });
});

describe("detectShellDialect", () => {
  it("is POSIX off Windows, and on Windows under Git Bash / MSYS (MSYSTEM or SHELL set)", () => {
    assert.strictEqual(detectShellDialect("linux", {}), "posix");
    assert.strictEqual(detectShellDialect("darwin", {}), "posix");
    assert.strictEqual(detectShellDialect("win32", { MSYSTEM: "MINGW64" }), "posix");
    assert.strictEqual(detectShellDialect("win32", { SHELL: "/usr/bin/bash" }), "posix");
  });

  it("is PowerShell in a plain Windows terminal", () => {
    assert.strictEqual(detectShellDialect("win32", {}), "powershell");
  });
});

// Copilot review on PR #27: the printed commands were POSIX-only while presented as copyable on
// Windows. A `'` is `'\''` in POSIX but `''` in PowerShell, and PowerShell has no printf.
describe("shellQuote", () => {
  it("leaves plain paths, flags and URLs bare in both dialects", () => {
    for (const arg of ["--file", "draft/scripts/app.ts", "https://x.bluestep.net/files/1/draft/", "--message=v1"]) {
      assert.strictEqual(shellQuote(arg, "posix"), arg);
      assert.strictEqual(shellQuote(arg, "powershell"), arg);
    }
  });

  it("POSIX: single-quotes spaces and shell characters, and writes a ' as '\\''", () => {
    assert.strictEqual(shellQuote("My Component/draft/app.ts", "posix"), "'My Component/draft/app.ts'");
    assert.strictEqual(shellQuote("fix $HOME & `x`", "posix"), "'fix $HOME & `x`'");
    assert.strictEqual(shellQuote("it's", "posix"), "'it'\\''s'");
    assert.strictEqual(shellQuote("=cmd", "posix"), "'=cmd'", "zsh expands a leading =");
    assert.strictEqual(shellQuote("", "posix"), "''");
  });

  it("PowerShell: single-quotes, doubles a ', and quotes @ and , which it would parse", () => {
    assert.strictEqual(shellQuote("it's", "powershell"), "'it''s'");
    assert.strictEqual(shellQuote("fix $HOME & `x`", "powershell"), "'fix $HOME & `x`'");
    assert.strictEqual(shellQuote("C:\\U\\My Comp\\draft\\app.ts", "powershell"), "'C:\\U\\My Comp\\draft\\app.ts'");
    assert.strictEqual(shellQuote("@args", "powershell"), "'@args'");
    assert.strictEqual(shellQuote("a,b", "powershell"), "'a,b'");
    assert.strictEqual(shellQuote("", "powershell"), "''");
  });
});

describe("overwriteCommand", () => {
  const args = ["--yes", "push", "--file", "U1/Bob's Comp/draft/scripts/app.ts", "--snapshot"];

  it("repeats the push as given, --yes included, with one --overwrite per declined file", () => {
    assert.strictEqual(
      overwriteCommand(args, ["scripts/app.ts", "README.md"], "posix"),
      "b6p --yes push --file 'U1/Bob'\\''s Comp/draft/scripts/app.ts' --snapshot --overwrite scripts/app.ts --overwrite README.md"
    );
  });

  it("quotes for PowerShell when asked", () => {
    assert.strictEqual(
      overwriteCommand(args, ["scripts/app.ts"], "powershell"),
      "b6p --yes push --file 'U1/Bob''s Comp/draft/scripts/app.ts' --snapshot --overwrite scripts/app.ts"
    );
  });
});

describe("deleteCommand", () => {
  const args = ["--yes", "--json", "push", "--file", "d/app.ts", "--message", "v2 fix"];

  it("POSIX: drops --yes and pipes Yes with printf, keeping every other argument", () => {
    assert.strictEqual(
      deleteCommand(args, "posix"),
      "printf 'Yes\\n' | b6p --json push --file d/app.ts --message 'v2 fix'"
    );
  });

  it("PowerShell: pipes the string 'Yes' (no printf there)", () => {
    assert.strictEqual(deleteCommand(args, "powershell"), "'Yes' | b6p --json push --file d/app.ts --message 'v2 fix'");
  });
});

describe("canonicalPushArgs", () => {
  it("rewrites the deprecated top-level spelling to the noun-first one", () => {
    assert.deepStrictEqual(canonicalPushArgs(["push", "--file", "a.ts"]), ["script", "push", "--file", "a.ts"]);
    assert.deepStrictEqual(canonicalPushArgs(["--yes", "--json", "push", "--file", "a.ts"]), [
      "--yes",
      "--json",
      "script",
      "push",
      "--file",
      "a.ts",
    ]);
  });

  it("leaves the noun-first spelling alone", () => {
    const args = ["--yes", "script", "push", "--file", "a.ts"];
    assert.deepStrictEqual(canonicalPushArgs(args), args);
  });

  it("is what the printed commands use", () => {
    assert.match(
      overwriteCommand(canonicalPushArgs(["push"]), ["a.ts"], "posix"),
      /^b6p script push --overwrite a\.ts$/
    );
    assert.match(deleteCommand(canonicalPushArgs(["--yes", "push"]), "posix"), /b6p script push$/);
  });
});
