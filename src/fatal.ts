import { EXIT_FAILURE, EXIT_SIGINT, EXIT_SUCCESS, stdoutJsonWritten, markStdoutJson } from "./exit";
import { PromptCancelledError } from "./providers/CliPrompt";

/**
 * The exit code for an error that reached the top level: `130` for a prompt interrupted with
 * Ctrl-C, `1` for everything else.
 * @param error What was thrown
 * @lastreviewed null
 */
export function fatalExitCode(error: Error): number {
  return error instanceof PromptCancelledError ? EXIT_SIGINT : EXIT_FAILURE;
}

/**
 * The exit code when stdout's reader hangs up (`b6p ... | head -1`): the code the command already
 * set if it failed, `0` otherwise. Exiting `0` unconditionally masked a failed push behind `| head`.
 * @param current `process.exitCode` at the moment of the `EPIPE`
 * @lastreviewed null
 */
export function exitCodeOnEpipe(current: typeof process.exitCode): number {
  const code = Number(current ?? EXIT_SUCCESS);
  return code === 0 || Number.isNaN(code) ? EXIT_SUCCESS : code;
}

/**
 * Report an error that reached the top level and return the exit code.
 *
 * Under `--json` stdout carries the documented `{"error","errors"}` body, unless something already
 * wrote a JSON document there (`withCore` writes one for failures reported through `Prompt.error`,
 * and for a success payload), so stdout never holds two. The human message always goes to stderr.
 * @param err What was thrown
 * @param opts `json` and `verbose` are the root flags; `stdout` and `stderr` are injectable for tests
 * @lastreviewed null
 */
export function reportFatal(
  err: unknown,
  opts: {
    json: boolean;
    verbose: boolean;
    stdout?: { write(s: string): unknown };
    stderr?: { write(s: string): unknown };
  }
): number {
  const error = err instanceof Error ? err : new Error(String(err));
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  stderr.write(`${error.message}\n`);
  // A stack is noise for the expected failures (bad path, no credentials) but is the only useful
  // output for an unexpected one, so gate it on --verbose.
  if (opts.verbose && error.stack) {
    stderr.write(`${error.stack}\n`);
  }
  if (opts.json && !stdoutJsonWritten()) {
    markStdoutJson();
    stdout.write(JSON.stringify({ error: error.message, errors: [error.message] }, null, 2) + "\n");
  }
  return fatalExitCode(error);
}
