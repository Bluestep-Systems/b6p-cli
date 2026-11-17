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
      await withCore(globals(), async ({ core, prompt }) => {
        // `info` is already a no-op under --json, so this is unconditional. It
        // goes to stderr, which keeps stdout clean for JSON consumers anyway.
        prompt.info(TOKEN_HINT);
        // Branch on whether a token exists rather than always calling core's
        // `update()`. `update()` starts with getOrCreate(), so on a fresh install
        // it prompts twice — once to create, once to amend — and `echo $TOKEN |
        // b6p auth set` stored the token and *then* failed on the second prompt
        // hitting EOF. createNew() is the single-prompt path, so one piped line
        // is enough.
        if (await core.auth.hasCredentials()) {
          await core.updateCredentials();
        } else {
          await core.auth.createNew();
        }
      });
    });

  auth
    .command("status")
    .description("Report whether an access token is stored")
    .action(async () => {
      await withCore(globals(), async ({ core, prompt, emitJson }) => {
        // hasCredentials() never prompts, so this stays safe to run unattended.
        // It reports whether a *well-formed* token is stored — core validates the
        // envelope (JSON, `scheme: "bearer"`, non-empty token) and nothing more.
        // It cannot tell you the token is still valid on the server, so a `true`
        // here is "something is configured", not "this will authenticate".
        const authenticated = await core.auth.hasCredentials();
        emitJson({ authenticated });
        // Reporting "no" is this command working correctly, so it stays exit 0.
        prompt.info(authenticated ? "Access token stored." : "No access token stored — run `b6p auth set`.");
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
