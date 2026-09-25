// The push exit rule and --json body (ClickUp 86bbqnrtp, 86bb94f3j).
//
// Core 0.8.0 reads every live (snapshot/) copy back after a snapshot push and returns
// `liveVerified: false` when one is still wrong after a re-send. Core already clears
// `historyRecorded` then, so the old rule caught it by accident; the rule now names it, and this
// table is what keeps a refactor from dropping either signal.
import { describe, it } from "node:test";
import assert from "node:assert";
import type { PushResult } from "@bluestep-systems/b6p-core";
import { pushExitCode, toPushJson } from "../src/pushOutcome";

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
