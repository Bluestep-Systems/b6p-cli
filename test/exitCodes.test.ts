// Unit + end-to-end spec for how `b6p` reports failure to the shell.
//
// Core reports most failures through Prompt.error / Logger.error and then
// returns normally instead of throwing, so an exit code derived from "did the
// action resolve?" reported success for commands that plainly failed. These
// tests pin the replacement: the adapters count what crosses their error
// channels, and a non-zero count becomes exit 1.
//
// Authored in TS and bundled to dist-test/ by esbuild.test.js; see the note in
// WindowsRestartManagerLockDiagnoser.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EXIT_FAILURE, EXIT_SUCCESS, FailureTracker } from "../src/exit";
import { CliPrompt } from "../src/providers/CliPrompt";
import { CliLogger } from "../src/providers/CliLogger";

/** Run `fn` with stderr swallowed, so the adapters under test stay quiet. */
function silenceStderr<T>(fn: () => T): T {
  const original = process.stderr.write.bind(process.stderr);
  // The adapters only ever pass a string; the cast keeps the assignment to the
  // overloaded `write` signature honest without widening anything to `any`.
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    return fn();
  } finally {
    process.stderr.write = original;
  }
}

test("a fresh tracker reports no failure", () => {
  const failures = new FailureTracker();
  assert.equal(failures.failed, false);
  assert.equal(failures.count, 0);
});

test("CliPrompt counts error() and nothing else", () => {
  const failures = new FailureTracker();
  const prompt = new CliPrompt();
  prompt.setFailureTracker(failures);

  silenceStderr(() => {
    prompt.info("informational");
    prompt.warn("a warning is not a failure");
  });
  assert.equal(failures.failed, false, "info/warn must not fail the command");

  silenceStderr(() => prompt.error("the operation failed"));
  assert.equal(failures.count, 1);
});

test("CliLogger counts error() and nothing else", () => {
  const failures = new FailureTracker();
  const logger = new CliLogger({ verbose: true });
  logger.setFailureTracker(failures);

  silenceStderr(() => {
    logger.info("informational");
    logger.debug("debugging");
    logger.warn("a warning is not a failure");
  });
  assert.equal(failures.failed, false, "info/debug/warn must not fail the command");

  silenceStderr(() => logger.error("the operation failed"));
  assert.equal(failures.count, 1);
});

test("counting is independent of whether the message is printed", () => {
  // --json suppresses prompt.info, and a non-verbose logger drops info/debug.
  // Neither may change what the shell is told, or `--json` would mask failures
  // from exactly the unattended callers that depend on the exit code.
  const failures = new FailureTracker();
  const prompt = new CliPrompt({ json: true });
  const logger = new CliLogger({ verbose: false });
  prompt.setFailureTracker(failures);
  logger.setFailureTracker(failures);

  silenceStderr(() => {
    prompt.error("failed under --json");
    logger.error("failed while not verbose");
  });
  assert.equal(failures.count, 2);
});

test("every reported failure is counted, so partial failure is still failure", () => {
  // ScriptService.deploy catches each target's failure into logger.error and
  // then prints "Deploy complete!". A deploy in which every target failed must
  // not report success.
  const failures = new FailureTracker();
  const logger = new CliLogger();
  logger.setFailureTracker(failures);

  silenceStderr(() => {
    logger.error("Failed to deploy to https://a.example/");
    logger.error("Failed to deploy to https://b.example/");
  });
  assert.equal(failures.count, 2);
  assert.equal(failures.failed, true);
});

// ── End to end ────────────────────────────────────────────────────────
//
// The unit tests above pin the counting; only running the real binary proves the
// count reaches the shell. `pretest` builds dist/cli.js so this always has an
// artifact to run.

const CLI = path.join(process.cwd(), "dist", "cli.js");

/**
 * Run the built CLI with a throwaway HOME.
 *
 * The CLI reads and writes `~/.b6p` (shared state, and the legacy basic-auth
 * purge), so an un-isolated run would touch the developer's real credentials.
 */
function runCli(args: string[]): number {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-test-home-"));
  try {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(result.error, undefined, `spawn failed: ${result.error?.message}`);
    assert.notEqual(result.status, null, "CLI was killed by a signal (timeout?)");
    return result.status as number;
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("commands that succeed exit 0", () => {
  assert.equal(runCli(["--version"]), EXIT_SUCCESS);
  assert.equal(runCli(["--help"]), EXIT_SUCCESS);
});

test("`auth status` with no token is a report, not a failure", () => {
  // Answering "no" is the command working correctly. Callers branch on the
  // reported value; only a broken lookup should be an error.
  assert.equal(runCli(["--json", "auth", "status"]), EXIT_SUCCESS);
});

test("a reported failure exits non-zero", () => {
  // Regression: each of these printed an ERROR line and exited 0.
  assert.equal(runCli(["--json", "--yes", "script", "deploy", "/nonexistent-b6p-config.json"]), EXIT_FAILURE);
  assert.equal(
    runCli(["--json", "--yes", "script", "setup", "--file", "/nonexistent/path/file.ts"]),
    EXIT_FAILURE
  );
});

test("the deprecated aliases carry the same exit code as the namespaced form", () => {
  assert.equal(runCli(["--json", "--yes", "deploy", "/nonexistent-b6p-config.json"]), EXIT_FAILURE);
});

test("usage errors exit non-zero", () => {
  assert.equal(runCli(["bogus-command"]), EXIT_FAILURE);
  assert.equal(runCli(["script", "push", "--bogus-flag"]), EXIT_FAILURE);
});
