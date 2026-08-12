// Unit + end-to-end spec for how `b6p` reports failure to the shell.
//
// Core reports most failures through Prompt.error and then
// returns normally instead of throwing, so an exit code derived from "did the
// action resolve?" reported success for commands that plainly failed. These
// tests pin the replacement: the prompt counts what crosses its error
// channel, and a non-zero count becomes exit 1.
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
  const failures = new FailureTracker(() => {});
  assert.equal(failures.failed, false);
  assert.equal(failures.count, 0);
});

test("CliPrompt counts error() and nothing else", () => {
  const failures = new FailureTracker(() => {});
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

test("CliLogger.error is diagnostic and never fails the command", () => {
  // REGRESSION: counting this made a successful first `script pull` exit 1.
  // ScriptRoot.modifyGitIgnore reports a missing .gitignore through logger.error
  // and then creates the file and carries on, and ScriptFile.download consults
  // .gitignore before every file — so the first pull of any script recorded a
  // "failure" while the second did not. Logger has no failure tracker at all now;
  // this test pins that it stays that way.
  const logger = new CliLogger({ verbose: true });
  assert.equal(
    "setFailureTracker" in logger,
    false,
    "CliLogger must not be wired to the failure tracker — see FailureTracker docs"
  );
  silenceStderr(() => logger.error("Error reading .gitignore file: FileNotFoundError"));
});

test("counting is independent of whether the message is printed", () => {
  // --json suppresses prompt.info but must not suppress failure accounting, or
  // it would mask failures from exactly the unattended callers that depend on
  // the exit code.
  const failures = new FailureTracker(() => {});
  const prompt = new CliPrompt({ json: true });
  prompt.setFailureTracker(failures);

  silenceStderr(() => prompt.error("failed under --json"));
  assert.equal(failures.count, 1);
  assert.deepEqual(failures.messages, ["failed under --json"]);
});

test("the tracker signals on the first failure, not at teardown", () => {
  // The exit code must be settled as each failure is recorded. An action whose
  // promise never settles (a prompt that reaches EOF) never reaches a `finally`,
  // and a failure recorded before that must still reach the shell.
  let signals = 0;
  const failures = new FailureTracker(() => {
    signals += 1;
  });
  const prompt = new CliPrompt();
  prompt.setFailureTracker(failures);
  silenceStderr(() => prompt.error("first"));
  assert.equal(signals, 1, "signalled eagerly");
  silenceStderr(() => prompt.error("second"));
  assert.equal(signals, 2);
});

test("every reported failure is retained in order", () => {
  const failures = new FailureTracker(() => {});
  const prompt = new CliPrompt();
  prompt.setFailureTracker(failures);
  silenceStderr(() => {
    prompt.error("first failure");
    prompt.error("second failure");
  });
  assert.equal(failures.count, 2);
  assert.deepEqual(failures.messages, ["first failure", "second failure"]);
});

// ── End to end ────────────────────────────────────────────────────────
//
// The unit tests above pin the counting; only running the real binary proves the
// count reaches the shell. `pretest` builds dist/cli.js so this always has an
// artifact to run.

// Derived from the bundle's own location (dist-test/ -> ../dist), not cwd: a
// cwd-relative path spawns a nonexistent file from any other directory, and
// Node exits 1 for "module not found" too — so the failure assertions below
// would have passed against no binary at all.
const CLI = path.join(__dirname, "..", "dist", "cli.js");

/**
 * Run the built CLI with a throwaway HOME.
 *
 * The CLI reads and writes `~/.b6p` (shared state and credentials), so an
 * un-isolated run would touch the developer's real secrets.
 */
interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], input = ""): CliRun {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-test-home-"));
  try {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      timeout: 60_000,
      input,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(result.error, undefined, `spawn failed: ${result.error?.message}`);
    assert.notEqual(result.status, null, "CLI was killed by a signal (timeout?)");
    // A missing binary, or a crash, also exits 1. Asserting only on the code let
    // these tests pass against no binary at all, so prove the CLI really ran.
    assert.doesNotMatch(result.stderr, /Cannot find module/, "CLI binary missing — run npm run compile");
    return { status: result.status as number, stdout: result.stdout, stderr: result.stderr };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("commands that succeed exit 0", () => {
  const version = runCli(["--version"]);
  assert.equal(version.status, EXIT_SUCCESS);
  assert.match(version.stdout, /^\d+\.\d+\.\d+/, "should print a real version");
  assert.equal(runCli(["--help"]).status, EXIT_SUCCESS);
});

test("`auth status` with no token is a report, not a failure", () => {
  // Answering "no" is the command working correctly. Callers branch on the
  // reported value; only a broken lookup should be an error.
  const run = runCli(["--json", "auth", "status"]);
  assert.equal(run.status, EXIT_SUCCESS);
  assert.deepEqual(JSON.parse(run.stdout), { authenticated: false });
});

test("a reported failure exits non-zero and says why", () => {
  // Regression: each of these printed an ERROR line and exited 0.
  const deploy = runCli(["--json", "--yes", "script", "deploy", "/nonexistent-b6p-config.json"]);
  assert.equal(deploy.status, EXIT_FAILURE);
  assert.match(deploy.stderr, /Config file not found/);
  // The failure must be machine-readable, not just an English sentence on stderr.
  assert.match(JSON.parse(deploy.stdout).error, /Config file not found/);
  // A reported failure is not a crash — no stack trace should reach the user.
  assert.doesNotMatch(deploy.stderr, /\s+at /, "reported failures must not print a stack");

  const setup = runCli(["--json", "--yes", "script", "setup", "--file", "/nonexistent/path/file.ts"]);
  assert.equal(setup.status, EXIT_FAILURE);
  assert.ok(JSON.parse(setup.stdout).error, "should emit a JSON error payload");
});

test("`script audit` outside a script tree fails instead of printing null", () => {
  // Regression: this emitted a literal `null` on stdout at exit 0, so a caller
  // doing `jq '.changedFiles | length'` read 0 and concluded "in sync" from a
  // command that never contacted the server.
  const run = runCli(["--json", "--yes", "script", "audit", "--file", "/tmp"]);
  assert.equal(run.status, EXIT_FAILURE);
  assert.notEqual(run.stdout.trim(), "null");
});

test("--yes refuses to block on a prompt it cannot answer", () => {
  // Regression: --yes did not suppress core's input prompts, so this blocked on
  // stdin until the CI job timed out. stdin is held open (not EOF) to prove the
  // refusal comes from --yes rather than from the stream closing.
  const run = runCli(["--yes", "script", "push"], "");
  assert.equal(run.status, EXIT_FAILURE);
  assert.match(run.stderr, /--yes/, "should explain that --yes cannot answer the prompt");
});

test("a closed stdin fails rather than silently exiting 0", () => {
  // Regression: readline's question() never settles when the stream closes, so
  // the action promise hung, the teardown never ran, and Node exited 0 from a
  // command that did nothing.
  const run = runCli(["script", "push"], "");
  assert.equal(run.status, EXIT_FAILURE);
});

test("the deprecated aliases carry the same exit code as the namespaced form", () => {
  const run = runCli(["--json", "--yes", "deploy", "/nonexistent-b6p-config.json"]);
  assert.equal(run.status, EXIT_FAILURE);
  assert.match(run.stderr, /deprecated/, "the alias should still warn");
});

test("the deprecation notice reaches paths that never run an action", () => {
  // `--help` and argument-validation failures short-circuit before the preAction
  // hook, so the description is the only carrier there.
  assert.match(runCli(["push", "--help"]).stdout, /deprecated: use `b6p script push`/);
  assert.match(runCli(["help", "push"]).stdout, /deprecated: use `b6p script push`/);
});

test("usage errors exit non-zero", () => {
  assert.equal(runCli(["bogus-command"]).status, EXIT_FAILURE);
  assert.equal(runCli(["script", "push", "--bogus-flag"]).status, EXIT_FAILURE);
});

test("check-updates is wired to a real update service", () => {
  // Regression: the CLI never passed updateServiceConfig, so this could only
  // ever report "Update service is not configured" — and once failures started
  // setting the exit code, it failed unconditionally for every user.
  const run = runCli(["--json", "check-updates"]);
  assert.doesNotMatch(run.stderr, /Update service is not configured/);
});
