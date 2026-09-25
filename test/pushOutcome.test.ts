// The push exit rule and --json body (ClickUp 86bbqnrtp, 86bb94f3j).
//
// Core 0.8.0 reads every live (snapshot/) copy back after a snapshot push and returns
// `liveVerified: false` when one is still wrong after a re-send. Core already clears
// `historyRecorded` then, so the old rule caught it by accident; the rule now names it, and this
// table is what keeps a refactor from dropping either signal.
import { describe, it } from "node:test";
import assert from "node:assert";
import type { PushResult } from "@bluestep-systems/b6p-core";
import {
  declinedPushJson,
  deleteCommand,
  overwriteCommand,
  pushExitCode,
  shellQuote,
  toPushJson,
} from "../src/pushOutcome";

/** A clean snapshot push; each case overrides what it tests. */
function result(overrides: Partial<PushResult> = {}): PushResult {
  return {
    pushed: true,
    historyRecorded: true,
    typeCheckDiagnostics: 0,
    liveVerified: true,
    liveMismatches: [],
    keptPlatformOnly: [],
    ...overrides,
  };
}

describe("pushExitCode", () => {
  it("is 0 for a clean snapshot push", () => {
    assert.strictEqual(pushExitCode(result()), 0);
  });

  it("is 0 for a clean plain push (no compile, no read-back)", () => {
    assert.strictEqual(pushExitCode(result({ typeCheckDiagnostics: null, liveVerified: null })), 0);
  });

  it("is 0 when the user cancelled at the target-URL prompt (null)", () => {
    assert.strictEqual(pushExitCode(null), 0);
  });

  it("is 1 when nothing was uploaded (pushed: false, e.g. app.js missing or without code)", () => {
    assert.strictEqual(pushExitCode(result({ pushed: false, historyRecorded: false, liveVerified: null })), 1);
  });

  it("is 1 when the snapshot history entry was not recorded", () => {
    assert.strictEqual(pushExitCode(result({ historyRecorded: false })), 1);
  });

  it("is 1 when a live copy is still wrong, even if historyRecorded were true", () => {
    // Core never returns this combination today; the rule must not depend on it.
    assert.strictEqual(pushExitCode(result({ liveVerified: false, liveMismatches: [".build/scripts/app.js"] })), 1);
  });

  it("is 1 for the combination core returns on a failed read-back", () => {
    assert.strictEqual(
      pushExitCode(result({ historyRecorded: false, liveVerified: false, liveMismatches: [".build/scripts/app.js"] })),
      1
    );
  });

  it("is 0 when a copy could not be compared (liveVerified: null): core warns instead", () => {
    assert.strictEqual(pushExitCode(result({ liveVerified: null })), 0);
  });

  it("is 1 when the snapshot shipped with type-check diagnostics", () => {
    assert.strictEqual(pushExitCode(result({ typeCheckDiagnostics: 3 })), 1);
  });

  it("is 0 when kept platform-only files are the only news", () => {
    assert.strictEqual(pushExitCode(result({ keptPlatformOnly: ["scripts/old.ts"] })), 0);
  });
});

describe("toPushJson", () => {
  it("keeps every PushResult field and adds an empty declinedOverwrites", () => {
    const r = result({ liveVerified: false, liveMismatches: ["a.js"], keptPlatformOnly: ["b.ts"] });
    assert.deepStrictEqual(toPushJson(r), { ...r, declinedOverwrites: [] });
  });
});

// ClickUp 86bc2h3ef: a declined overwrite throws, so no PushResult exists. --json used to print
// nothing at all; it now prints the same shape as every other push, marked as not pushed.
describe("declinedPushJson", () => {
  it("reads as a push that did not run, with the declined files", () => {
    const json = declinedPushJson(["scripts/app.ts", "README.md"]);
    assert.deepStrictEqual(json, {
      pushed: false,
      historyRecorded: false,
      typeCheckDiagnostics: null,
      liveVerified: null,
      liveMismatches: [],
      keptPlatformOnly: [],
      declinedOverwrites: ["scripts/app.ts", "README.md"],
    });
    assert.strictEqual(pushExitCode(json), 1, "the same body must never read as success");
  });

  it("has exactly the keys of a normal push's JSON", () => {
    assert.deepStrictEqual(Object.keys(declinedPushJson([])).sort(), Object.keys(toPushJson(result())).sort());
  });
});

describe("shellQuote", () => {
  it("leaves plain paths, flags and URLs bare", () => {
    for (const arg of ["--file", "draft/scripts/app.ts", "https://x.bluestep.net/files/1/draft/", "--message=v1"]) {
      assert.strictEqual(shellQuote(arg), arg);
    }
  });

  it("single-quotes spaces and shell characters, and escapes a single quote", () => {
    assert.strictEqual(shellQuote("My Component/draft/app.ts"), "'My Component/draft/app.ts'");
    assert.strictEqual(shellQuote("fix $HOME & `x`"), "'fix $HOME & `x`'");
    assert.strictEqual(shellQuote("it's"), "'it'\\''s'");
    assert.strictEqual(shellQuote(""), "''");
  });
});

describe("overwriteCommand", () => {
  it("repeats the push as given, --yes included, with one --overwrite per declined file", () => {
    const args = ["--yes", "push", "--file", "U1/My Comp/draft/scripts/app.ts", "--snapshot"];
    assert.strictEqual(
      overwriteCommand(args, ["scripts/app.ts", "README.md"]),
      "b6p --yes push --file 'U1/My Comp/draft/scripts/app.ts' --snapshot --overwrite scripts/app.ts --overwrite README.md"
    );
  });
});

describe("deleteCommand", () => {
  it("drops --yes and pipes Yes, keeping every other argument", () => {
    const args = ["--yes", "--json", "push", "--file", "d/app.ts", "--message", "v2 fix"];
    assert.strictEqual(deleteCommand(args), "printf 'Yes\\n' | b6p --json push --file d/app.ts --message 'v2 fix'");
  });
});
