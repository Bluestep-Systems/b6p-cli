// The shipped bundle carries no TypeScript compiler: the platform builds every push, and neither core nor the CLI
// compiles anything at run time. TypeScript is a build tool here (check-types) and must never be bundled.
//
// Runs against dist/cli.js, which `pretest` builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const BUNDLE = path.join(__dirname, "..", "dist", "cli.js");

test("dist/cli.js contains no TypeScript compiler", () => {
  const text = fs.readFileSync(BUNDLE, "utf-8");
  for (const marker of ["createProgram", "typescript.js", "transpileModule", "createCompilerHost"]) {
    assert.ok(!text.includes(marker), `the bundle mentions ${marker}`);
  }
  assert.ok(!/require\(["']typescript["']\)/.test(text), "the bundle requires typescript");
});
