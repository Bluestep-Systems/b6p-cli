import { Command } from "commander";
import { registerCommands } from "./commands";

/**
 * Build the fully-registered `b6p` root command.
 *
 * Kept separate from [index.ts](index.ts) — which only injects the build-time
 * version and parses `process.argv` — so the command tree can be constructed and
 * inspected without running it. `test/commandTree.test.ts` depends on that.
 * @param version Value for `--version`; the CLI passes the esbuild-injected one.
 * @lastreviewed null
 */
export function buildProgram(version: string): Command {
  const program = new Command("b6p")
    .description("BlueStep platform CLI")
    .version(version)
    .option("--yes", "Skip confirmation prompts")
    .option("--json", "Machine-readable JSON output")
    .option("--verbose", "Verbose logging")
    .option("--quiet", "Suppress progress output");

  registerCommands(program);
  return program;
}
