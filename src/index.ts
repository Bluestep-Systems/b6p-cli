import { buildProgram } from "./program";
import { EXIT_FAILURE, EXIT_SIGINT, EXIT_SUCCESS } from "./exit";
import { PromptCancelledError } from "./providers/CliPrompt";

// Replaced at build time by esbuild's `define` with the package.json version.
declare const __B6P_VERSION__: string;

// A consumer that stops reading (`b6p --json report | head -1`) closes the pipe
// under us; the next write raises EPIPE as an unhandled 'error' event and Node
// dies with a stack trace. Downstream hanging up early is normal shell usage, so
// treat it as a clean finish. Registered before any output can be produced.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") {
    process.exit(EXIT_SUCCESS);
  }
  throw err;
});

/** The pre-restructure top-level verbs, now spelled `b6p script <verb>`. */
const MOVED_VERBS = new Set(["push", "pull", "audit", "deploy", "setup"]);

/**
 * The moved-verb message for an old spelling, or null when the invocation is
 * not one. Checked on raw argv BEFORE commander dispatches, because the hidden
 * failing stubs cannot intercept everything: the root `--version` is parsed
 * during option parsing (`b6p push -V` printed the version and exited 0), and
 * the built-in `help` command shows a stub's own help (`b6p help push`).
 * Global flags are all boolean, so the first non-flag token is the command.
 * @lastreviewed null
 */
function movedVerbMessage(argv: string[]): string | null {
  const tokens = [];
  for (const arg of argv) {
    if (arg === "--") {
      break;
    }
    if (!arg.startsWith("-")) {
      tokens.push(arg);
      if (tokens.length === 2) {
        break;
      }
    }
  }
  const verb = tokens[0] === "help" ? tokens[1] : tokens[0];
  if (verb !== undefined && MOVED_VERBS.has(verb)) {
    return `\`b6p ${verb}\` has moved: run \`b6p script ${verb}\` with the same arguments.`;
  }
  return null;
}

const movedMessage = movedVerbMessage(process.argv.slice(2));
if (movedMessage !== null) {
  process.stderr.write(`${movedMessage}\n`);
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ error: movedMessage, errors: [movedMessage] }, null, 2) + "\n");
  }
  process.exitCode = EXIT_FAILURE;
} else {
  runProgram();
}

function runProgram(): void {
  buildProgram(__B6P_VERSION__)
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      process.stderr.write(`${error.message}\n`);
      // A stack is noise for the expected failures (bad path, no credentials) but
      // is the only useful output for an unexpected one, so gate it on --verbose.
      if (process.argv.includes("--verbose") && error.stack) {
        process.stderr.write(`${error.stack}\n`);
      }
      // Set the code rather than calling process.exit(): an in-flight `--json`
      // write to stdout is asynchronous, and exiting here can truncate it. Every
      // handle that would keep the loop alive is released in withCore's `finally`,
      // so Node exits on its own with this code.
      process.exitCode = error instanceof PromptCancelledError ? EXIT_SIGINT : EXIT_FAILURE;
    });
}
