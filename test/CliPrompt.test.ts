// Regression tests for CliPrompt's end-of-input handling.
//
// THE BUG (ClickUp 86bb8f6v0, and the blocker found while bumping to core
// 0.6.0): readline's `question()` promise never settles once stdin has ended.
// Nothing rejected, nothing resolved — the event loop simply drained and node
// exited **0**. Two user-visible faces of the same defect:
//
//   * `b6p --yes pull <url>` on a machine with no stored credentials printed
//     "Enter your access token:" and exited 0 having pulled nothing. Core 0.5.0
//     replaced basic auth with bearer tokens and has no migration path, so this
//     was every existing user's first run after upgrading.
//   * A push that hit a SECOND "upstairs file changed" prompt with only one
//     piped answer died with readline's internal "readline was closed" (the
//     cached interface had already closed at EOF), after uploading some files.
//
// THE FIX: `ask()` races `question()` against the interface's `close` event and
// throws NonInteractiveInputError instead, and stdin ending is remembered so a
// later prompt fails fast with the same actionable message rather than
// readline's internal error. The CLI's top-level catch turns that into a
// message on stderr and exit 1.
import { describe, it } from "node:test";
import assert from "node:assert";
import { PassThrough } from "node:stream";
import { CliPrompt, NonInteractiveInputError } from "../src/providers/CliPrompt";

/** A stdin stand-in: not a TTY, so the masked read falls back to the line read. */
function makeInput(lines: string[], opts: { keepOpen?: boolean } = {}): PassThrough {
  const input = new PassThrough();
  for (const line of lines) {
    input.write(line + "\n");
  }
  if (!opts.keepOpen) {
    input.end();
  }
  return input;
}

function makeOutput(): PassThrough {
  const out = new PassThrough();
  out.resume(); // drain, so writes never block
  return out;
}

// Every test must finish on its own; a hang here is the bug under test. Node's
// test runner would otherwise sit until the suite timeout with no diagnosis.
const WATCHDOG_MS = 5_000;
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`HUNG: ${label} did not settle within ${WATCHDOG_MS}ms`)), WATCHDOG_MS).unref()
    ),
  ]);
}

describe("CliPrompt end-of-input handling", () => {
  it("reads a piped answer", async () => {
    const prompt = new CliPrompt({ input: makeInput(["a-real-token"]), output: makeOutput() });
    const answer = await withTimeout(prompt.inputBox({ prompt: "Enter your access token" }), "inputBox");
    assert.strictEqual(answer, "a-real-token");
  });

  it("throws instead of hanging when stdin is already at EOF", async () => {
    // The auth blocker: no token stored, nothing on stdin.
    const prompt = new CliPrompt({ input: makeInput([]), output: makeOutput() });
    await assert.rejects(
      () => withTimeout(prompt.inputBox({ prompt: "Enter your access token" }), "inputBox"),
      (e: unknown) => {
        assert.ok(e instanceof NonInteractiveInputError, `expected NonInteractiveInputError, got ${String(e)}`);
        assert.match(e.message, /Enter your access token/);
        assert.match(e.message, /b6p auth set/);
        return true;
      }
    );
  });

  it("throws on a SECOND prompt when only one answer was piped (86bb8f6v0)", async () => {
    const prompt = new CliPrompt({ input: makeInput(["Overwrite"]), output: makeOutput() });
    const first = await withTimeout(prompt.confirm("overwrite file 1?", ["Overwrite", "Cancel"]), "confirm 1");
    assert.strictEqual(first, "Overwrite");
    await assert.rejects(
      () => withTimeout(prompt.confirm("overwrite file 2?", ["Overwrite", "Cancel"]), "confirm 2"),
      (e: unknown) => {
        // Must be our actionable error, NOT readline's "readline was closed".
        assert.ok(e instanceof NonInteractiveInputError, `expected NonInteractiveInputError, got ${String(e)}`);
        assert.doesNotMatch(e.message, /readline was closed/);
        return true;
      }
    );
  });

  it("throws rather than hanging on a masked (password) read at EOF", async () => {
    const prompt = new CliPrompt({ input: makeInput([]), output: makeOutput() });
    await assert.rejects(
      () => withTimeout(prompt.inputBox({ prompt: "Password", password: true }), "masked inputBox"),
      NonInteractiveInputError
    );
  });

  it("auto-confirms without touching stdin under --yes", async () => {
    // stdin deliberately left open and empty: if confirm() read from it, the
    // watchdog would fire.
    const prompt = new CliPrompt({ autoYes: true, input: makeInput([], { keepOpen: true }), output: makeOutput() });
    const answer = await withTimeout(prompt.confirm("Sync?", ["Cancel", "Sync"]), "confirm");
    assert.strictEqual(answer, "Cancel", "--yes must take the FIRST option, which core makes the safe one");
  });

  it("returns a default value under --yes without reading stdin", async () => {
    const prompt = new CliPrompt({ autoYes: true, input: makeInput([], { keepOpen: true }), output: makeOutput() });
    const answer = await withTimeout(prompt.inputBox({ prompt: "Workspace", value: "/tmp/ws" }), "inputBox");
    assert.strictEqual(answer, "/tmp/ws");
  });

  it("matches a confirm answer case-insensitively, and empty input takes the default", async () => {
    // Each answer is delivered AFTER its question is registered. readline emits
    // a `line` event for every buffered line as soon as the bytes arrive, so
    // pre-writing two answers loses the second — a property of readline, not of
    // this provider, and the reason a multi-prompt run needs a real responder.
    const input = makeInput([], { keepOpen: true });
    const prompt = new CliPrompt({ input, output: makeOutput() });
    const first = prompt.confirm("q1", ["Cancel", "Sync"]);
    input.write("sYnC\n");
    assert.strictEqual(await withTimeout(first, "confirm 1"), "Sync");
    const second = prompt.confirm("q2", ["Cancel", "Sync"]);
    input.write("\n");
    assert.strictEqual(await withTimeout(second, "confirm 2"), "Cancel", "empty answer takes the first option");
  });

  it("writes prompts and messages to the injected output, never stdout", async () => {
    const output = new PassThrough();
    let written = "";
    output.on("data", (chunk: Buffer) => {
      written += chunk.toString("utf8");
    });
    const prompt = new CliPrompt({ input: makeInput(["x"]), output });
    await withTimeout(prompt.inputBox({ prompt: "Question" }), "inputBox");
    prompt.warn("careful");
    prompt.error("broken");
    assert.match(written, /Question/);
    assert.match(written, /WARNING: careful/);
    assert.match(written, /ERROR: broken/);
  });
});
