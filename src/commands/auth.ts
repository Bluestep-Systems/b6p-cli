import type { Command } from "commander";
import { withCore, type GlobalOpts } from "../context";

/**
 * Shown before delegating to the core credential prompt.
 *
 * Core 0.5.0 replaced basic auth with a bearer scheme, and its prompt asks for an
 * "access token" without saying what one looks like. Core treats the token as
 * fully opaque — it has no `b6pt_` constant and should not grow one just to
 * phrase a prompt — so naming the format is the terminal's job. A user upgrading
 * from a username/password install otherwise meets a bare token prompt with no
 * indication of what to paste.
 */
const TOKEN_HINT = "Platform access tokens begin with `b6pt_`. Paste the whole token, including that prefix.";

/**
 * Mount credential management at `b6p auth <verb>`.
 * @lastreviewed null
 */
export function registerAuthCommands(program: Command): void {
  const globals = () => program.opts<GlobalOpts>();
  const auth = program.command("auth").description("Manage credentials");

  auth
    .command("set")
    .description("Set or update the access token")
    .action(async () => {
      await withCore(globals(), async ({ core, prompt, globalOpts }) => {
        if (!globalOpts.json) {
          prompt.info(TOKEN_HINT);
        }
        await core.updateCredentials();
      });
    });

  auth
    .command("status")
    .description("Report whether an access token is stored")
    .action(async () => {
      await withCore(globals(), async ({ core, prompt, globalOpts, emitJson }) => {
        // hasCredentials() never prompts, so this stays safe to run unattended;
        // it also reports false for a stored-but-malformed token, matching what
        // the next authenticated command would actually do.
        const authenticated = await core.auth.hasCredentials();
        emitJson({ authenticated });
        if (!globalOpts.json) {
          prompt.info(authenticated ? "Access token stored." : "No access token stored — run `b6p auth set`.");
        }
      });
    });

  auth
    .command("clear")
    .description("Clear the stored access token")
    .action(async () => {
      await withCore(globals(), async ({ core }) => {
        await core.auth.clear();
      });
    });
}
