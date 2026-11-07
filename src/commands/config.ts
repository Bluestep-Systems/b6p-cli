import type { Command } from "commander";
import { withCore, type GlobalOpts } from "../context";

/**
 * Mount settings management at `b6p config <verb>`.
 * @lastreviewed null
 */
export function registerConfigCommands(program: Command): void {
  const globals = () => program.opts<GlobalOpts>();
  const config = program.command("config").description("Manage configuration");

  config
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action(async (key: string, value: string) => {
      await withCore(globals(), async ({ core }) => {
        // Accept JSON scalars/objects so booleans and numbers round-trip; fall
        // back to the raw string when the value isn't valid JSON.
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          parsed = value;
        }
        await core.setConfig(key, parsed);
      });
    });

  config
    .command("reset")
    .description("Reset all settings to defaults")
    .action(async () => {
      await withCore(globals(), async ({ core }) => {
        await core.clearSettings();
      });
    });
}
