// Deploy's pre-flight and exit code (CU-86bd2nrvf): core swallows per-target failures, so the CLI checks the author
// first and counts what core reported.
import { describe, it } from "node:test";
import assert from "node:assert";
import type { DeployTargetResult } from "@bluestep-systems/b6p-core";
import { describeDeploy, planDeploy, removeTempDir } from "../src/deployRun";

const CONFIG = JSON.stringify({ sourceRootPath: "/no/such/script", targets: [{ url: "u", snapshot: true }] });
const missing = (): Promise<unknown> =>
  Promise.reject(Object.assign(new Error("No commit author found"), { code: "IDENTITY_REQUIRED" }));
const found = (): Promise<unknown> => Promise.resolve({ name: "A", email: "a@example.com" });

describe("planDeploy", () => {
  it("fails before deploying when no author resolves anywhere, with the fixes spelled out", async () => {
    const plan = await planDeploy(CONFIG, undefined, undefined, missing);
    assert.strictEqual(plan.ok, false);
    assert.match(plan.ok ? "" : plan.message, /--author/);
    assert.match(plan.ok ? "" : plan.message, /b6p config set author/);
  });

  it("goes on when git config or the environment gives an author", async () => {
    assert.deepStrictEqual(await planDeploy(CONFIG, undefined, undefined, found), { ok: true, configText: null });
  });

  it("does not ask core to resolve when the flag, the file or the setting gave one", async () => {
    let asked = 0;
    const spy = (): Promise<unknown> => {
      asked += 1;
      return missing();
    };
    assert.strictEqual((await planDeploy(CONFIG, "Jane Doe <jane@example.com>", undefined, spy)).ok, true);
    assert.strictEqual((await planDeploy(CONFIG, undefined, "Jane Doe <jane@example.com>", spy)).ok, true);
    const withFile = JSON.stringify({ ...JSON.parse(CONFIG), author: { name: "J", email: "j@example.com" } });
    assert.strictEqual((await planDeploy(withFile, undefined, undefined, spy)).ok, true);
    assert.strictEqual(asked, 0);
  });

  it("reports a malformed winning author and a bad lower one never blocks", async () => {
    const bad = await planDeploy(CONFIG, "nobody", undefined, found);
    assert.strictEqual(bad.ok, false);
    const fine = await planDeploy(CONFIG, "Jane Doe <jane@example.com>", "garbage", found);
    assert.strictEqual(fine.ok, true);
  });

  it("leaves an unreadable config to core", async () => {
    assert.deepStrictEqual(await planDeploy(null, undefined, undefined, missing), { ok: true, configText: null });
  });

  it("lets other resolver failures through", async () => {
    await assert.rejects(
      planDeploy(CONFIG, undefined, undefined, () => Promise.reject(new Error("boom"))),
      /boom/
    );
  });
});

const OK: DeployTargetResult = {
  target: "https://a/",
  pushed: true,
  commitSha: "c".repeat(40),
  publishedSha: "d".repeat(40),
  publishError: null,
  switchedToGit: false,
};

describe("describeDeploy", () => {
  it("is 0 when every target pushed and published, and lists the SHAs", () => {
    const out = describeDeploy([OK, { ...OK, target: "https://b/" }]);
    assert.strictEqual(out.exitCode, 0);
    assert.match(out.info[0], /https:\/\/a\/: pushed c+, published d+/);
    assert.deepStrictEqual(out.errors, []);
  });

  it("is 1 when any target has an error, and says which", () => {
    const out = describeDeploy([OK, { ...OK, target: "https://b/", pushed: false, error: new Error("no author") }]);
    assert.strictEqual(out.exitCode, 1);
    assert.match(out.errors[0], /https:\/\/b\/: failed: no author/);
  });

  it("is 1 when a target's publish failed, though its draft was pushed", () => {
    const out = describeDeploy([{ ...OK, publishedSha: null, publishError: "refused" }]);
    assert.strictEqual(out.exitCode, 1);
    assert.match(out.errors[0], /not published: refused/);
  });

  it("is 1 when a target was not pushed", () => {
    const out = describeDeploy([{ ...OK, pushed: false, commitSha: null, publishedSha: null }]);
    assert.strictEqual(out.exitCode, 1);
    assert.match(out.errors[0], /nothing was pushed/);
  });

  it("is 1 when core returned no results (bad config, already reported)", () => {
    assert.strictEqual(describeDeploy(null).exitCode, 1);
  });

  it("reports a switch to git per target, as a notice", () => {
    const out = describeDeploy([OK, { ...OK, target: "https://b/", switchedToGit: true }]);
    assert.strictEqual(out.notices.length, 1);
    assert.match(out.notices[0], /^https:\/\/b\/: .*one-way/);
    assert.strictEqual(out.exitCode, 0);
  });

  it("a plain-push target (no published sha, no error) is fine", () => {
    assert.strictEqual(describeDeploy([{ ...OK, publishedSha: null }]).exitCode, 0);
  });
});

describe("removeTempDir", () => {
  it("warns, and does not throw, when the cleanup fails", async () => {
    const warnings: string[] = [];
    await removeTempDir(
      "/tmp/x",
      () => Promise.reject(new Error("EBUSY")),
      (m) => warnings.push(m)
    );
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /\/tmp\/x.*EBUSY/);
  });

  it("is silent when it works", async () => {
    const warnings: string[] = [];
    await removeTempDir(
      "/tmp/x",
      () => Promise.resolve(),
      (m) => warnings.push(m)
    );
    assert.deepStrictEqual(warnings, []);
  });
});
