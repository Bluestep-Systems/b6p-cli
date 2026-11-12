// Deploy's pre-flight and exit code (CU-86bd2nrvf): core swallows per-target failures, so the CLI checks the author
// first and counts what core reported.
import { describe, it } from "node:test";
import assert from "node:assert";
import { deployExitCode, planDeploy, removeTempDir } from "../src/deployRun";

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

describe("deployExitCode", () => {
  it("is 0 with nothing reported and 1 when any target failed or any publish was refused", () => {
    assert.strictEqual(deployExitCode(0), 0);
    assert.strictEqual(deployExitCode(1), 1);
    assert.strictEqual(deployExitCode(3), 1);
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
