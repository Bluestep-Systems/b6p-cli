import type { Command } from "commander";
import { withCore, type GlobalOpts } from "../context";

/**
 * Mount the introspection commands — the ones that report on this install rather
 * than acting on the platform.
 * @lastreviewed null
 */
export function registerDiagnosticCommands(program: Command): void {
  const globals = () => program.opts<GlobalOpts>();

  program
    .command("report")
    .description("Report current state")
    .action(async () => {
      await withCore(globals(), async ({ core, emitJson }) => {
        emitJson(await core.report());
      });
    });

  program
    .command("check-updates")
    .description("Check for CLI updates")
    .action(async () => {
      await withCore(globals(), async ({ core }) => {
        await core.checkForUpdates();
      });
    });
}
