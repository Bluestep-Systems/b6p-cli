import { buildProgram } from "./program";

// Replaced at build time by esbuild's `define` with the package.json version.
declare const __B6P_VERSION__: string;

buildProgram(__B6P_VERSION__)
  .parseAsync(process.argv)
  .catch((err: Error) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
