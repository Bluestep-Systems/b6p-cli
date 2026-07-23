// Test build: bundle each test/**/*.test.ts (and the CLI source it imports) into
// dist-test/*.test.cjs, so `node --test dist-test/` runs on plain compiled JS.
//
// Why a separate build from esbuild.js: the main build has a single entry
// (src/index.ts) and produces the shipped bundle; tests need their own entries
// and must NOT touch dist/. Emitting compiled .cjs (rather than running .ts via
// a loader) keeps the tests runnable across the whole CI Node matrix (18/20/22)
// with no type-stripping and no extra dependency. See .claude/quick-tasks/
// windows-lock-diagnoser.md for the rationale.
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const TEST_DIR = "test";
const OUT_DIR = "dist-test";

function findTests(dir) {
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTests(full));
    } else if (entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const entryPoints = findTests(TEST_DIR);
  if (entryPoints.length === 0) {
    console.error(`No *.test.ts files found under ${TEST_DIR}/`);
    process.exit(1);
  }
  // Rebuild from scratch so a renamed/removed test can't leave a stale artifact behind.
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  await esbuild.build({
    entryPoints,
    bundle: true,
    format: "cjs",
    platform: "node", // Node builtins (node:test, child_process, …) stay external automatically.
    outdir: OUT_DIR,
    outExtension: { ".js": ".cjs" },
    sourcemap: "inline",
    logLevel: "info",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
