import type { Command } from "commander";
import { registerScriptCommands } from "./script";
import { registerAuthCommands } from "./auth";
import { registerSessionCommands } from "./sessions";
import { registerConfigCommands } from "./config";
import { registerDiagnosticCommands } from "./diagnostics";

/**
 * Build the whole `b6p` command tree.
 *
 * The top level is a set of **nouns** — one per platform subsystem — and each
 * noun owns its verbs: `b6p script push`, `b6p auth set`. Adding a subsystem
 * means adding a `register*Commands` module here and nothing else; no existing
 * command changes shape. This mirrors `B6PCore`, where every subsystem hangs off
 * the composition root as its own service (`core.script`, …) rather than
 * flattening onto it.
 *
 * Registration order is help-output order, so keep the platform subsystems ahead
 * of the machine-local ones.
 * @lastreviewed null
 */
export function registerCommands(program: Command): void {
  registerScriptCommands(program);
  registerAuthCommands(program);
  registerSessionCommands(program);
  registerConfigCommands(program);
  registerDiagnosticCommands(program);
}
