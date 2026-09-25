// CliLogger.hasReported: lets `b6p push` print a refused upload once.
//
// Core logs a failed upload as "Failed to push <file>: <details>" and rethrows the same
// Err.FileSendError, whose message is <details>. Without this check the CLI printed the details a
// second time (b6p-core verification, row 4).
import { describe, it } from "node:test";
import assert from "node:assert";
import { CliLogger } from "../src/providers/CliLogger";

/** Runs `fn` with stderr captured, so the test output stays clean. */
function captureStderr(fn: () => void): string {
  const original = process.stderr.write.bind(process.stderr);
  let written = "";
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    written += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return written;
}

describe("CliLogger.hasReported", () => {
  const details = "Failed to send snapshot/.build/scripts/app.js: 500 Internal Server Error";

  it("finds a message core logged inside a longer error line", () => {
    const logger = new CliLogger();
    const out = captureStderr(() => logger.error(`Failed to push /w/draft/.build/scripts/app.js: ${details}`));
    assert.match(out, /^\[ERROR\] Failed to push/);
    assert.strictEqual(logger.hasReported(details), true);
  });

  it("does not claim a message that was never logged as an error", () => {
    const logger = new CliLogger();
    captureStderr(() => {
      logger.warn(details);
      logger.error("something else");
    });
    assert.strictEqual(logger.hasReported(details), false);
  });

  it("never matches an empty message", () => {
    const logger = new CliLogger();
    captureStderr(() => logger.error("anything"));
    assert.strictEqual(logger.hasReported(""), false);
  });
});
