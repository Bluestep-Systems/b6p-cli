// The push exit rule and --json body (ClickUp 86bbqnrtp, 86bb94f3j; git-only in 0.9.0).
//
// A snapshot fails on any of: nothing pushed, nothing published, a publish error, a failed read-back.
// This table is what keeps a refactor from dropping a signal.
import { describe, it } from "node:test";
import assert from "node:assert";
import type { PushResult } from "@bluestep-systems/b6p-core";
import {
  declinedPushJson,
  deleteCommand,
  describePush,
  detectShellDialect,
  overwriteCommand,
  pushExitCode,
  shellQuote,
  toPushJson,
} from "../src/pushOutcome";

const SHA_DRAFT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_PUBLISHED = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** A clean snapshot push; each case overrides what it tests. */
function result(overrides: Partial<PushResult> = {}): PushResult {
  return {
    pushed: true,
    commitSha: SHA_DRAFT,
    publishedSha: SHA_PUBLISHED,
    publishError: null,
    switchedToGit: false,
    typeCheckDiagnostics: 0,
    liveVerified: true,
    liveMismatches: [],
    keptPlatformOnly: [],
    ...overrides,
  };
}

describe("pushExitCode", () => {
  it("is 0 for a clean snapshot push", () => {
    assert.strictEqual(pushExitCode(result(), true), 0);
  });

  it("is 0 for a clean plain push (no publish, no compile, no read-back)", () => {
    const plain = result({ publishedSha: null, typeCheckDiagnostics: null, liveVerified: null });
    assert.strictEqual(pushExitCode(plain, false), 0);
  });

  it("is 0 when the user cancelled at the target-URL prompt (null)", () => {
    assert.strictEqual(pushExitCode(null, true), 0);
    assert.strictEqual(pushExitCode(null, false), 0);
  });

  it("is 1 when nothing was pushed (pushed: false), plain or snapshot", () => {
    const aborted = result({ pushed: false, commitSha: null, publishedSha: null, liveVerified: null });
    assert.strictEqual(pushExitCode(aborted, false), 1);
    assert.strictEqual(pushExitCode(aborted, true), 1);
  });

  it("is 1 on a snapshot when nothing was published (publishedSha null)", () => {
    assert.strictEqual(pushExitCode(result({ publishedSha: null, liveVerified: null }), true), 1);
  });

  it("is 1 on a snapshot when the platform refused the publish (publishError set)", () => {
    const refused = result({ publishedSha: null, publishError: "refused", liveVerified: null });
    assert.strictEqual(pushExitCode(refused, true), 1);
  });

  it("is 1 on a snapshot when publishError is set even if a published sha is present", () => {
    assert.strictEqual(pushExitCode(result({ publishError: "refresh failed" }), true), 1);
  });

  it("is 1 on a snapshot when the published branch reads back at another commit", () => {
    const wrong = result({ liveVerified: false, liveMismatches: [".build/scripts/app.js"] });
    assert.strictEqual(pushExitCode(wrong, true), 1);
  });

  it("is 0 on a snapshot when the read-back could not run (liveVerified: null): core warns instead", () => {
    assert.strictEqual(pushExitCode(result({ liveVerified: null }), true), 0);
  });

  it("is 1 when the snapshot shipped with type-check diagnostics", () => {
    assert.strictEqual(pushExitCode(result({ typeCheckDiagnostics: 3 }), true), 1);
  });

  it("is 0 when kept platform-only files are the only news", () => {
    assert.strictEqual(pushExitCode(result({ keptPlatformOnly: ["scripts/old.ts"] }), true), 0);
  });

  it("is 0 when the push switched the script to git (reported, not a failure)", () => {
    assert.strictEqual(pushExitCode(result({ switchedToGit: true }), true), 0);
  });

  it("ignores publish fields on a plain push: they were not asked for", () => {
    // Core leaves them null on a plain push; a stray value must not turn a pushed draft into a failure.
    assert.strictEqual(pushExitCode(result({ publishedSha: null, publishError: "x", liveVerified: false }), false), 0);
  });
});

describe("describePush", () => {
  it("shows the commit and published SHAs", () => {
    const lines = describePush(result(), true);
    assert.deepStrictEqual(lines.info, [`Draft commit: ${SHA_DRAFT}`, `Published commit: ${SHA_PUBLISHED}`]);
    assert.deepStrictEqual(lines.errors, []);
    assert.deepStrictEqual(lines.notices, []);
  });

  it("says plainly, and as a notice, that the script was switched to git and that it is one-way", () => {
    const lines = describePush(result({ switchedToGit: true }), true);
    assert.strictEqual(lines.notices.length, 1);
    assert.match(lines.notices[0], /switched from WebDAV to git/);
    assert.match(lines.notices[0], /one-way/);
  });

  it("reports a failed publish as an error and omits the published line", () => {
    const lines = describePush(result({ publishedSha: null, publishError: "refused by the platform" }), true);
    assert.deepStrictEqual(lines.info, [`Draft commit: ${SHA_DRAFT}`]);
    assert.strictEqual(lines.errors.length, 1);
    assert.match(lines.errors[0], /refused by the platform/);
  });

  it("flags a snapshot with neither a published sha nor an error", () => {
    const lines = describePush(result({ publishedSha: null }), true);
    assert.strictEqual(lines.errors.length, 1);
    assert.match(lines.errors[0], /nothing was published/);
  });

  it("a plain push only shows its draft commit", () => {
    const lines = describePush(result({ publishedSha: null }), false);
    assert.deepStrictEqual(lines.info, [`Draft commit: ${SHA_DRAFT}`]);
    assert.deepStrictEqual(lines.errors, []);
  });
});

describe("toPushJson", () => {
  it("has no historyRecorded and carries the git fields", () => {
    const json = toPushJson(result()) as Record<string, unknown>;
    assert.ok(!("historyRecorded" in json));
    for (const key of ["commitSha", "publishedSha", "publishError", "switchedToGit"]) {
      assert.ok(key in json, key);
    }
  });

  it("keeps every PushResult field and adds an empty declinedOverwrites", () => {
    const r = result({ liveVerified: false, liveMismatches: ["a.js"], keptPlatformOnly: ["b.ts"] });
    assert.deepStrictEqual(toPushJson(r), { ...r, declinedOverwrites: [], publishRefusal: null });
  });
});

// ClickUp 86bc2h3ef: a declined overwrite throws, so no PushResult exists. --json used to print
// nothing at all; it now prints the same shape as every other push, marked as not pushed.
describe("declinedPushJson", () => {
  it("reads as a push that did not run, with the declined files", () => {
    const json = declinedPushJson(["scripts/app.ts", "README.md"]);
    assert.deepStrictEqual(json, {
      pushed: false,
      commitSha: null,
      publishedSha: null,
      publishError: null,
      switchedToGit: false,
      typeCheckDiagnostics: null,
      liveVerified: null,
      liveMismatches: [],
      keptPlatformOnly: [],
      declinedOverwrites: ["scripts/app.ts", "README.md"],
      publishRefusal: null,
    });
    assert.strictEqual(pushExitCode(json, true), 1, "the same body must never read as success");
  });

  it("has exactly the keys of a normal push's JSON", () => {
    assert.deepStrictEqual(Object.keys(declinedPushJson([])).sort(), Object.keys(toPushJson(result())).sort());
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
