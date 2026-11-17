// Core's git-mode refusals become CLI messages with the fix spelled out (CU-86bd2nrvf).
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  GitStagedChangesError,
  GitSwitchDeclinedError,
  GitSymlinkError,
  GitWrongBranchError,
} from "@bluestep-systems/b6p-core";
import { describeGitError } from "../src/gitErrors";

describe("describeGitError", () => {
  it("GitSwitchDeclinedError: says nothing changed, that the switch is one-way, and to use --enable-git (--yes declines)", () => {
    const text = describeGitError(new GitSwitchDeclinedError()) ?? "";
    assert.match(text, /Nothing was changed/);
    assert.match(text, /one-way/);
    assert.match(text, /--enable-git/);
    assert.match(text, /--yes never switches/);
  });

  it("GitWrongBranchError: keeps core's message and names the checkout command", () => {
    const text = describeGitError(new GitWrongBranchError("main")) ?? "";
    assert.match(text, /branch "main"/);
    assert.match(text, /git switch draft/);
  });

  it("GitStagedChangesError: lists the files and says how to commit or unstage", () => {
    const text = describeGitError(new GitStagedChangesError(["a.ts"])) ?? "";
    assert.match(text, /a\.ts/);
    assert.match(text, /restore --staged/);
  });

  it("GitSymlinkError: lists the paths and says to replace the links", () => {
    const text = describeGitError(new GitSymlinkError(["lib/x.ts", "lib/y.ts"])) ?? "";
    assert.match(text, /symbolic link/);
    assert.match(text, /lib\/x\.ts\nlib\/y\.ts/);
    assert.match(text, /nothing was changed/);
  });

  it("ignores every other error", () => {
    assert.strictEqual(describeGitError(new Error("boom")), undefined);
    assert.strictEqual(describeGitError("GitSwitchDeclinedError"), undefined);
    assert.strictEqual(describeGitError(Object.assign(new Error("401"), { name: "GitAuthError" })), undefined);
  });
});
