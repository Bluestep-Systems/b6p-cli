import type { Command } from "commander";
import { withCore, type GlobalOpts } from "../context";

/**
 * Mount session management at `b6p sessions <verb>`.
 * @lastreviewed null
 */
export function registerSessionCommands(program: Command): void {
  const globals = () => program.opts<GlobalOpts>();
  const sessions = program.command("sessions").description("Manage sessions");

  sessions
    .command("clear")
    .description("Clear all active sessions")
    .action(async () => {
      await withCore(globals(), async ({ core }) => {
        await core.sessionManager.clearAll();
      });
    });
}
