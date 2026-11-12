// Core's git-mode refusals become CLI messages with the fix spelled out (CU-86bd2nrvf).
import { describe, it } from "node:test";
import assert from "node:assert";
import { describeGitError } from "../src/gitErrors";

function named(name: string, message: string, extra: object = {}): Error {
  return Object.assign(new Error(message), { name }, extra);
}

describe("describeGitError", () => {
  it("GitSwitchDeclinedError: says nothing changed, that the switch is one-way, and to use --enable-git (--yes declines)", () => {
    const text = describeGitError(named("GitSwitchDeclinedError", "Switching was not confirmed")) ?? "";
    assert.match(text, /Nothing was changed/);
    assert.match(text, /one-way/);
    assert.match(text, /--enable-git/);
    assert.match(text, /--yes never switches/);
  });

  it("GitWrongBranchError: keeps core's message and names the checkout command", () => {
    const text =
      describeGitError(named("GitWrongBranchError", 'The draft folder has the branch "main" checked out')) ?? "";
    assert.match(text, /branch "main"/);
    assert.match(text, /git switch draft/);
  });

  it("GitStagedChangesError: lists the files and says how to commit or unstage", () => {
    const text =
      describeGitError(named("GitStagedChangesError", "1 file(s) have staged changes:\n\na.ts", { paths: ["a.ts"] })) ??
      "";
    assert.match(text, /a\.ts/);
    assert.match(text, /restore --staged/);
  });

  it("GitSymlinkError: lists the paths and says to replace the links", () => {
    const text =
      describeGitError(named("GitSymlinkError", " incoming file(s)", { paths: ["lib/x.ts", "lib/y.ts"] })) ?? "";
    assert.match(text, /symbolic link/);
    assert.match(text, /lib\/x\.ts\nlib\/y\.ts/);
    assert.match(text, /nothing was changed/);
  });

  it("ignores every other error", () => {
    assert.strictEqual(describeGitError(new Error("boom")), undefined);
    assert.strictEqual(describeGitError("GitSwitchDeclinedError"), undefined);
    assert.strictEqual(describeGitError(named("GitAuthError", "401")), undefined);
  });
});
