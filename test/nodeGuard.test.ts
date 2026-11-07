// A runtime floor for the Node major. npm only warns about `engines`, so without a check an
// unsupported Node runs and may crash with a raw stack instead of a clear message.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { MIN_NODE_MAJOR, nodeVersionProblem } from "../src/nodeGuard";

test("a Node below the floor gets a clear message", () => {
  assert.match(nodeVersionProblem("22.12.0") ?? "", /requires Node\.js 24 or newer.*22\.12\.0/);
  assert.match(nodeVersionProblem("18.20.4") ?? "", /requires Node\.js 24/);
});

test("the floor and anything newer pass", () => {
  assert.equal(nodeVersionProblem("24.0.0"), null);
  assert.equal(nodeVersionProblem("26.4.0"), null);
});

test("an unparseable version does not block startup", () => {
  assert.equal(nodeVersionProblem("weird"), null);
});

test("the floor matches package.json engines", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as {
    engines: { node: string };
  };
  assert.equal(pkg.engines.node, `>=${MIN_NODE_MAJOR}`);
});
