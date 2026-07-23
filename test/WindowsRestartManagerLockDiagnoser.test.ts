// Unit spec for WindowsRestartManagerLockDiagnoser.
//
// The CLI ships as a single esbuild bundle, so there are no per-module dist/
// files to require (unlike b6p-core's tests). This file is authored in TS and
// bundled to dist-test/ by esbuild.test.js, then run with `node --test` — which
// works on the whole CI Node matrix (18/20/22) since the runnable artifact is
// plain compiled .cjs, not type-stripped TS.
//
// Pins the ILockDiagnoser contract: never throws; returns [] off Windows,
// on any probe error, and for malformed probe output.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LockHolder } from "@bluestep-systems/b6p-core";
import { WindowsRestartManagerLockDiagnoser, parseHolders } from "../src/lockDiagnoser/WindowsRestartManagerLockDiagnoser";

/** Temporarily forces process.platform for the duration of a test. */
function withPlatform(value: NodeJS.Platform, run: () => Promise<void>): Promise<void> {
  const original = process.platform;
  Object.defineProperty(process, "platform", { value, configurable: true });
  return run().finally(() => Object.defineProperty(process, "platform", { value: original, configurable: true }));
}

test("diagnose returns [] on non-Windows without invoking the probe", async () => {
  await withPlatform("linux", async () => {
    let probeCalled = false;
    const diagnoser = new WindowsRestartManagerLockDiagnoser(async () => {
      probeCalled = true;
      return [{ name: "Code.exe", pid: 1234 }];
    });

    const result = await diagnoser.diagnose("C:\\Users\\someone\\.b6p\\state.json");

    assert.deepEqual(result, []);
    assert.equal(probeCalled, false, "probe must not run off Windows");
  });
});

test("diagnose swallows a probe error and returns []", async () => {
  await withPlatform("win32", async () => {
    const diagnoser = new WindowsRestartManagerLockDiagnoser(async () => {
      throw new Error("boom");
    });

    const result = await diagnoser.diagnose("C:\\fake\\path\\state.json");

    assert.deepEqual(result, []);
  });
});

test("diagnose passes the probe's holders through on success", async () => {
  await withPlatform("win32", async () => {
    const holders: LockHolder[] = [
      { name: "Code.exe", pid: 1234 },
      { name: "OneDrive.exe", pid: 5678 },
    ];
    const diagnoser = new WindowsRestartManagerLockDiagnoser(async () => holders);

    const result = await diagnoser.diagnose("C:\\fake\\path\\state.json");

    assert.deepEqual(result, holders);
  });
});

test("parseHolders returns [] for empty, blank, or non-array output", () => {
  assert.deepEqual(parseHolders(""), []);
  assert.deepEqual(parseHolders("   \n  "), []);
  assert.deepEqual(parseHolders("[]"), []);
  assert.deepEqual(parseHolders("not json"), []);
  assert.deepEqual(parseHolders('{"name":"Code.exe","pid":1}'), []);
});

test("parseHolders keeps well-formed entries and drops malformed ones", () => {
  const raw = JSON.stringify([
    { name: "Code.exe", pid: 1234 },
    { name: "", pid: 2 }, // empty name dropped
    { name: "NoPid.exe" }, // missing pid dropped
    { name: "BadPid.exe", pid: "x" }, // non-numeric pid dropped
    { pid: 9 }, // missing name dropped
    { name: "OneDrive.exe", pid: 5678 },
  ]);

  assert.deepEqual(parseHolders(raw), [
    { name: "Code.exe", pid: 1234 },
    { name: "OneDrive.exe", pid: 5678 },
  ]);
});
