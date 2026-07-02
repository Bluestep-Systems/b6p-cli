// ============================================================================
// build-sea.mjs — Standalone binary builder (Node SEA)
// ============================================================================
// Turns the esbuild bundle (dist/cli.js) into a self-contained, Node-bundling
// `b6p` executable for the CURRENT platform/arch using Node's Single Executable
// Applications feature + postject. Node SEA cannot cross-compile, so CI runs
// this once per target OS/arch (see .github/workflows/release.yml); locally it
// builds for the developer's own platform so the mechanism can be verified.
//
// Produced asset names (the coordination contract the bspecs installer relies
// on):  Windows x64 → b6p-windows-x64.exe,  macOS x64 → b6p-macos-x64,
//        macOS arm64 → b6p-macos-arm64.  (Linux is built only for local dev
//        verification — it is not a shipped release asset.)
//
// Runs `node`/`npx`/`codesign` on the BUILD machine only (CI or a dev box) —
// never on the locked-down end-user machine, which receives just the finished
// binary. See docs/adr/0001-standalone-binary-toolchain.md.
// ============================================================================

import { execFileSync, execSync } from "node:child_process";
import { chmodSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// postject locates the injected blob via this fuse sentinel — the fixed value
// Node documents for SEA. It must match what the runtime looks for.
const SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const BLOB = "sea-prep.blob";
const SEA_CONFIG = "sea-config.json";

// Pin postject so release builds are reproducible and immune to a breaking
// change shipping under the floating `latest` tag. Bump deliberately.
const POSTJECT_VERSION = "1.0.0-alpha.6";

// Smoke-test guard: a binary that takes longer than this to print --help is
// treated as broken rather than hung.
const SMOKE_TIMEOUT_MS = 60_000;

const PLATFORM_LABEL = { win32: "windows", darwin: "macos", linux: "linux" };

/** Asset filename for the current platform/arch (e.g. `b6p-macos-arm64`). */
function assetName() {
  const label = PLATFORM_LABEL[process.platform];
  if (!label) {
    throw new Error(`Unsupported platform for SEA build: ${process.platform}`);
  }
  const ext = process.platform === "win32" ? ".exe" : "";
  return `b6p-${label}-${process.arch}${ext}`;
}

/** Run a shell command, echoing it and streaming its output. Throws on failure. */
function run(command) {
  console.error(`$ ${command}`);
  execSync(command, { stdio: "inherit" });
}

/** True when building on macOS, where Mach-O signing steps are required. */
const isMac = process.platform === "darwin";

function main() {
  const out = assetName();
  console.error(`Building standalone binary: ${out}`);

  // 1. Build the same bundle npm ships.
  run("npm run compile");

  // 2. Generate the SEA blob from dist/cli.js.
  run(`node --experimental-sea-config ${SEA_CONFIG}`);

  // 3. Copy the host Node runtime to the asset name; this copy becomes the binary.
  copyFileSync(process.execPath, out);
  if (process.platform !== "win32") {
    chmodSync(out, 0o755);
  }

  // 4. macOS: strip the inherited Node signature before injecting the blob.
  if (isMac) {
    run(`codesign --remove-signature ${out}`);
  }

  // 5. Inject the blob into the copied runtime. On Mach-O the blob lives in a
  //    dedicated segment; ELF/PE use a resource section, so the flag is mac-only.
  const machoFlag = isMac ? " --macho-segment-name NODE_SEA" : "";
  run(
    `npx --yes postject@${POSTJECT_VERSION} ${out} NODE_SEA_BLOB ${BLOB} --sentinel-fuse ${SENTINEL_FUSE}${machoFlag}`
  );

  // 6. macOS: re-sign ad-hoc. On Apple Silicon an unsigned arm64 binary is
  //    killed by the kernel on exec, so this is mandatory (not notarization).
  if (isMac) {
    run(`codesign --sign - ${out}`);
  }

  // 7. Checksum sidecar (sha256sum format: "<hash>  <file>").
  const digest = createHash("sha256").update(readFileSync(out)).digest("hex");
  writeFileSync(`${out}.sha256`, `${digest}  ${out}\n`);
  console.error(`sha256: ${digest}`);

  // 8. Smoke-test the produced binary — it must run standalone. We assert exit 0
  //    and non-empty output rather than a specific version string: the CLI's
  //    --version is independent of package.json, so pinning it here would be
  //    brittle. --help listing a known subcommand proves commander booted.
  smokeTest(out);

  console.error(`OK: ${out} built and verified.`);
}

/** Run the freshly built binary and fail loudly if it does not behave. */
function smokeTest(out) {
  const bin = resolve(out);
  const exec = (args) =>
    execFileSync(bin, args, { encoding: "utf8", timeout: SMOKE_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });

  console.error(`$ ${out} --version`);
  const version = exec(["--version"]).trim();
  if (!version) {
    throw new Error("Smoke test failed: --version produced no output.");
  }
  console.error(`  → ${version}`);

  console.error(`$ ${out} --help`);
  const help = exec(["--help"]);
  if (!/\bpush\b/.test(help)) {
    throw new Error("Smoke test failed: --help did not list expected subcommands.");
  }
}

try {
  main();
} catch (err) {
  console.error(`build-sea failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
