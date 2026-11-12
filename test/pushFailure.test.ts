// What a push that threw reads as, and that a retry is judged on its own (CU-86bd2nrvf).
import { describe, it } from "node:test";
import assert from "node:assert";
import { Err, GitSwitchDeclinedError, type PushResult } from "@bluestep-systems/b6p-core";
import { pushFailureOf } from "../src/pushFailure";
import { pushExitCode, toPushJson } from "../src/pushOutcome";

const SHA = "c".repeat(40);
const GOOD: PushResult = {
  pushed: true,
  commitSha: SHA,
  publishedSha: SHA,
  publishError: null,
  switchedToGit: false,
  typeCheckDiagnostics: 0,
  liveVerified: true,
  liveMismatches: [],
  keptPlatformOnly: [],
};

/** One CLI push attempt as the push command runs it: the result, or what it throws, turned into JSON and an exit code. */
async function attempt(push: () => Promise<PushResult | null>): Promise<{ json: unknown; exit: number }> {
  try {
    const result = await push();
    return { json: result ? toPushJson(result) : { cancelled: true }, exit: pushExitCode(result, true) };
  } catch (e) {
    const failure = pushFailureOf(e, ["push", "--file", "a.ts"], "posix");
    if (!failure) {
      throw e;
    }
    return { json: failure.json, exit: 1 };
  }
}

describe("pushFailureOf", () => {
  it("a declined overwrite lists the files, prints the retry command and reads as not pushed", () => {
    const f = pushFailureOf(new Err.OverwriteDeclinedError("declined", ["scripts/app.ts"]), ["push", "--yes"], "posix");
    assert.match(f?.notice ?? "", /b6p push --yes --overwrite scripts\/app\.ts/);
    assert.deepStrictEqual(f?.json.declinedOverwrites, ["scripts/app.ts"]);
    assert.strictEqual(f?.json.pushed, false);
  });

  it("a missing author and a malformed one are failures with the fix in the message", () => {
    const missing = Object.assign(new Error("No commit author found"), { code: "IDENTITY_REQUIRED" });
    assert.match(pushFailureOf(missing, [], "posix")?.message ?? "", /b6p config set author/);
  });

  it("a declined switch is a failure that says --enable-git and that --yes declines", () => {
    assert.match(pushFailureOf(new GitSwitchDeclinedError(), [], "posix")?.message ?? "", /--enable-git/);
  });

  it("a declined overwrite after the script was switched reports switchedToGit (the switch stands)", () => {
    const declined = new Err.OverwriteDeclinedError("declined", ["a.ts"]);
    assert.strictEqual(pushFailureOf(declined, [], "posix")?.json.switchedToGit, false);
    declined.switchedToGit = true;
    const failure = pushFailureOf(declined, [], "posix");
    assert.strictEqual(failure?.json.switchedToGit, true);
    assert.strictEqual(failure?.switchedToGit, true);
  });

  it("any error core marks as thrown after a switch reports it too", () => {
    const e = Object.assign(new Error("publish refused"), { code: "IDENTITY_REQUIRED", switchedToGit: true });
    assert.strictEqual(pushFailureOf(e, [], "posix")?.json.switchedToGit, true);
  });

  it("is undefined for any other error", () => {
    assert.strictEqual(pushFailureOf(new Error("boom"), [], "posix"), undefined);
  });
});

describe("two consecutive pushes, the first declined", () => {
  it("the retry is a new push: its own result and exit code, nothing carried over from the decline", async () => {
    let calls = 0;
    const push = async (): Promise<PushResult | null> => {
      calls += 1;
      if (calls === 1) {
        throw new Err.OverwriteDeclinedError("declined", ["scripts/app.ts"]);
      }
      return GOOD;
    };
    const first = await attempt(push);
    const second = await attempt(push);
    assert.strictEqual(first.exit, 1);
    assert.strictEqual((first.json as { pushed: boolean }).pushed, false);
    assert.strictEqual(second.exit, 0);
    assert.deepStrictEqual(second.json, { ...GOOD, declinedOverwrites: [] });
    assert.strictEqual(calls, 2, "the CLI calls core again; it does not short-cut a retry");
  });

  it("a retry that switches the script reports the switch", async () => {
    let calls = 0;
    const push = async (): Promise<PushResult | null> => {
      calls += 1;
      if (calls === 1) {
        throw new Err.OverwriteDeclinedError("declined", ["a.ts"]);
      }
      return { ...GOOD, switchedToGit: true };
    };
    await attempt(push);
    const second = await attempt(push);
    assert.strictEqual((second.json as { switchedToGit: boolean }).switchedToGit, true);
  });
});
