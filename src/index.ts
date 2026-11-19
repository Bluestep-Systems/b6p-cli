import "./requireNode";
import { buildProgram } from "./program";
import { exitCodeOnEpipe, reportFatal } from "./fatal";
import { isGitCredentialHelperArgv, runGitCredentialHelper } from "./gitCredentialHelper";
import { answerWithCore } from "./gitSetupRun";

// Replaced at build time by esbuild's `define` with the package.json version.
declare const __B6P_VERSION__: string;

if (isGitCredentialHelperArgv(process.argv)) {
  // git calling b6p as its credential helper (`b6p auth git-credential <action>`). Run before
  // Commander parses anything, so no `--help`, `--version` or flag error can print or exit non-zero,
  // and with its own stream and process handlers in place of the ones below.
  void runGitCredentialHelper(process.argv[4], answerWithCore);
} else {
  main();
}

function main(): void {
  // A consumer that stops reading (`b6p --json report | head -1`) closes the pipe
  // under us; the next write raises EPIPE as an unhandled 'error' event and Node
  // dies with a stack trace. Downstream hanging up early is normal shell usage, so
  // treat it as a clean finish. Registered before any output can be produced.
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") {
      // Keep a failure the command already recorded: `b6p script push | head -1` must not read as success.
      process.exit(exitCodeOnEpipe(process.exitCode));
    }
    throw err;
  });

  const program = buildProgram(__B6P_VERSION__);
  program.parseAsync(process.argv).catch((err: unknown) => {
    // Set the code rather than calling process.exit(): an in-flight `--json` write to stdout is
    // asynchronous, and exiting here can truncate it. Every handle that would keep the loop alive is
    // released in withCore's `finally`, so Node exits on its own with this code.
    process.exitCode = reportFatal(err, {
      json: program.opts<{ json?: boolean }>().json === true,
      verbose: process.argv.includes("--verbose"),
    });
  });
}
