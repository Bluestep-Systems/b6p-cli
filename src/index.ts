import { buildProgram } from "./program";
import { EXIT_FAILURE } from "./exit";

// Replaced at build time by esbuild's `define` with the package.json version.
declare const __B6P_VERSION__: string;

buildProgram(__B6P_VERSION__)
  .parseAsync(process.argv)
  .catch((err: Error) => {
    process.stderr.write(`${err.message}\n`);
    // Set the code rather than calling process.exit(): an in-flight `--json`
    // write to stdout is asynchronous, and exiting here can truncate it. Every
    // handle that would keep the loop alive is released in withCore's `finally`,
    // so Node exits on its own with this code.
    process.exitCode = EXIT_FAILURE;
  });
