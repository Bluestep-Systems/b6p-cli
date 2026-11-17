// Output-side specs for the gateway commands: the spinner must be off the line before stdout is
// written, and `kb push` must find its clone's top folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Spinner } from "../src/providers/Spinner";
import { writeStdout } from "../src/gatewayRun";
import { findCloneRoot } from "../src/cloneRoot";

test("writeStdout clears the spinner line first, so the secret stands alone on its line", () => {
  const events: string[] = [];
  const realErr = process.stderr.write.bind(process.stderr);
  const realOut = process.stdout.write.bind(process.stdout);
  process.stderr.write = ((chunk: string) => {
    events.push(`err:${JSON.stringify(chunk)}`);
    return true;
  }) as typeof process.stderr.write;
  process.stdout.write = ((chunk: string) => {
    events.push(`out:${JSON.stringify(chunk)}`);
    return true;
  }) as typeof process.stdout.write;
  const spinner = new Spinner("Creating token…", { enabled: true });
  try {
    spinner.start(); // draws a frame on the line, as in a terminal
    writeStdout({ spinner }, "b6pt_SECRET\n");
  } finally {
    spinner.stop();
    process.stderr.write = realErr;
    process.stdout.write = realOut;
  }
  const frame = events.findIndex((e) => e.startsWith("err:") && e.includes("Creating token"));
  const clear = events.findIndex((e) => e === `err:${JSON.stringify("\r\x1b[K")}`);
  const out = events.findIndex((e) => e.startsWith("out:"));
  assert.ok(frame >= 0 && clear > frame, "the spinner drew a frame and then cleared the line");
  assert.ok(out > clear, "stdout is written only after the line was cleared");
  const framesAfter = events.slice(out).filter((e) => e.includes("Creating token"));
  assert.equal(framesAfter.length, 0, "no spinner frame is redrawn after the secret");
  assert.equal(events[out], `out:${JSON.stringify("b6pt_SECRET\n")}`, "the secret is written as its own line");
});

test("findCloneRoot walks up to the nearest .git, and returns the start when there is none", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-cloneroot-"));
  try {
    const clone = path.join(root, "kb");
    const deep = path.join(clone, "docs", "guides");
    fs.mkdirSync(deep, { recursive: true });
    fs.mkdirSync(path.join(clone, ".git"));
    assert.equal(findCloneRoot(deep), clone);
    assert.equal(findCloneRoot(clone), clone);
    // A nested clone wins over the outer one.
    const inner = path.join(deep, "inner");
    fs.mkdirSync(path.join(inner, ".git"), { recursive: true });
    assert.equal(findCloneRoot(inner), inner);
    // No .git anywhere above the temp folder's own subtree: unchanged.
    const lone = path.join(root, "plain", "sub");
    fs.mkdirSync(lone, { recursive: true });
    const found = findCloneRoot(lone);
    assert.ok(found === lone || !found.startsWith(root), "never invents a root inside the scratch tree");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
