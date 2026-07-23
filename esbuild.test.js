// Test build + run: bundle each test/**/*.test.ts (and the CLI source it imports)
// into dist-test/*.test.cjs, then run them with `node --test`.
//
// Why a separate build from esbuild.js: the main build has a single entry
// (src/index.ts) and produces the shipped bundle; tests need their own entries
// and must NOT touch dist/. Emitting compiled .cjs (rather than running .ts via
// a loader) keeps the tests runnable across the whole CI Node matrix (18/20/22)
// with no type-stripping and no extra dependency.
//
// We spawn `node --test` with the EXPLICIT list of built files rather than a
// directory or glob: a bare directory positional is interpreted inconsistently
// across Node versions (18/20 search it; 22 tries to load it as a module), and
// glob expansion in `--test` isn't supported on 18/20. Explicit file paths work
// everywhere.
const esbuild = require("esbuild");
const { spawn } = require("child_process");
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

// Mirror esbuild's outdir mapping: test/<rel>.test.ts → dist-test/<rel>.test.cjs.
function outputFor(entry) {
  const rel = path.relative(TEST_DIR, entry).replace(/\.ts$/, ".cjs");
  return path.join(OUT_DIR, rel);
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

  const compiled = entryPoints.map(outputFor);
  const child = spawn(process.execPath, ["--test", ...compiled], { stdio: "inherit" });
  // If the runner can't even be spawned (e.g. a bad execPath), report cleanly
  // and fail rather than crashing with an unhandled 'error' event.
  child.on("error", (err) => {
    console.error(`Failed to start 'node --test': ${err.message}`);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
