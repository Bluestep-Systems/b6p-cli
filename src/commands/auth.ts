import type { Command } from "commander";
import { Err } from "@bluestep-systems/b6p-core";
import { withCore, type CliContext, type GlobalOpts } from "../context";
import { describeGatewayError } from "../gatewayErrors";
import { formatTable, printResult, runGateway, writeStdout } from "../gatewayRun";
import { confirmNeverExpires, confirmRevokeCurrent, parseExpires } from "../tokenExpiry";

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

  registerTokenCommands(auth, globals);
}

/**
 * Show a freshly minted secret exactly once. The secret goes to stdout alone, so
 * `TOKEN=$(b6p auth token create ...)` captures it; everything else goes to stderr. Under `--json`
 * the caller emits it as the top-level `secret` field instead. Never logged.
 * @lastreviewed null
 */
function printSecret(ctx: CliContext, secret: string): void {
  if (!ctx.globalOpts.json) {
    writeStdout(ctx, `${secret}\n`);
  }
}

/**
 * Run a call that mints a secret (`create`, `rotate`). When core throws an error that CARRIES the new
 * secret (`GatewayTokenStoreError`, `GatewayOffContractTokenError`) the secret exists nowhere else,
 * so it is printed once (stdout, or the top-level JSON `secret` field) before the command fails with
 * the "how to fix" text. Any other gateway error is reported as usual.
 * @lastreviewed null
 */
async function runMinting(ctx: CliContext, body: () => Promise<void>): Promise<void> {
  await runGateway(ctx, async () => {
    try {
      await body();
    } catch (err) {
      // The same body shape for every failure that carries a secret: the documented `{error, errors}`
      // plus `operation`, `stored` and the top-level `secret`.
      const carried =
        err instanceof Err.GatewayTokenStoreError
          ? { operation: "rotate", stored: false, secret: err.replacement.token }
          : err instanceof Err.GatewayOffContractTokenError
            ? { operation: err.operation, stored: err.stored, secret: err.secret }
            : undefined;
      if (carried === undefined) {
        throw err;
      }
      const error = describeGatewayError(err) ?? "The gateway answer could not be used.";
      printSecret(ctx, carried.secret);
      ctx.emitJson({ error, errors: [error], ...carried });
      ctx.fail(error);
    }
  });
}

const STORE_NOW = "Store this token now: it is shown only this once and cannot be read back.";

/**
 * Mount the caller's own tokens at `b6p auth token <verb>`. Needs the `tokens:self` scope on the
 * stored token. Nothing here addresses another user's tokens.
 * @lastreviewed null
 */
function registerTokenCommands(auth: Command, globals: () => GlobalOpts): void {
  const token = auth
    .command("token")
    .description("Manage your own gateway access tokens (needs the tokens:self scope)");

  token
    .command("list")
    .description("List your tokens (the secret is never shown); * marks the one b6p is using")
    .action(async () => {
      await withCore(
        globals(),
        async (ctx) => {
          await runGateway(ctx, async () => {
            const tokens = await ctx.core.gateway.tokens.list();
            const human =
              tokens.length === 0
                ? "No tokens."
                : formatTable(
                    ["", "ALIAS", "ID", "SCOPES", "EXPIRES", "LAST USED"],
                    tokens.map((t) => [
                      t.current ? "*" : "",
                      t.alias,
                      t.id,
                      t.scopes.join(","),
                      t.expiresAt ?? "never",
                      t.lastUsedAt ?? "-",
                    ])
                  );
            printResult(ctx, human, { tokens });
          });
        },
        "Listing tokens…"
      );
    });

  token
    .command("create")
    .description("Mint a token; the secret is printed once")
    .requiredOption("--alias <alias>", "A name for the token, unique among yours")
    .requiredOption(
      "--scopes <scopes>",
      "Comma-separated scopes (e.g. kb:read,kb:push,registry:read); at most your own"
    )
    .option("--expires <when>", "90d (default), another number of days like 30d, an ISO date, or never")
    .action(async (opts: { alias: string; scopes: string; expires?: string }) => {
      await withCore(
        globals(),
        async (ctx) => {
          const expires = parseExpires(opts.expires);
          if (expires.kind === "invalid") {
            ctx.fail(expires.message);
            return;
          }
          const scopes = opts.scopes
            .split(",")
            .map((x) => x.trim())
            .filter((x) => x !== "");
          if (expires.kind === "never" && !(await confirmNeverExpires(ctx.prompt, ctx.globalOpts.yes))) {
            ctx.fail("Cancelled: no token was created.");
            return;
          }
          await runMinting(ctx, async () => {
            const minted = await ctx.core.gateway.tokens.create({
              alias: opts.alias,
              scopes,
              ...(expires.kind === "never"
                ? { expiresAt: null }
                : expires.kind === "at"
                  ? { expiresAt: expires.iso }
                  : {}),
            });
            printSecret(ctx, minted.token);
            ctx.prompt.info(
              `Created token "${minted.alias}" (id ${minted.id}) with scopes ${minted.scopes.join(", ")}, ` +
                (minted.neverExpires ? "never expiring." : `expiring ${minted.expiresAt}.`)
            );
            ctx.prompt.warn(STORE_NOW);
            ctx.emitJson({ ...minted, secret: minted.token });
          });
        },
        "Creating token…"
      );
    });

  token
    .command("revoke")
    .description("Revoke one of your tokens at once")
    .requiredOption("--tokenid <alias|id>", "The token's alias or id (see `b6p auth token list`)")
    .action(async (opts: { tokenid: string }) => {
      await withCore(
        globals(),
        async (ctx) => {
          await runGateway(ctx, async () => {
            // Revoking the token b6p is using locks b6p out, so that one case asks first. Only a single clear
            // match is checked; no match or several is left to core, which refuses both.
            const mine = (await ctx.core.gateway.tokens.list()).filter(
              (t) => t.id === opts.tokenid || t.alias === opts.tokenid
            );
            if (mine.length === 1 && mine[0].current && !(await confirmRevokeCurrent(ctx.prompt, mine[0].alias))) {
              ctx.fail("Cancelled: the token was not revoked.");
              return;
            }
            const r = await ctx.core.gateway.tokens.revoke(opts.tokenid);
            printResult(ctx, `Revoked token "${r.alias}" (id ${r.id}).`, r);
            if (r.revokedCurrent) {
              ctx.prompt.warn(
                "That was the token b6p is using, so b6p now holds a dead token. Store another with `b6p auth set`."
              );
            }
          });
        },
        "Revoking token…"
      );
    });

  token
    .command("rotate")
    .description("Replace a token with a new secret (same alias, scopes and lifetime); the old one is revoked at once")
    .requiredOption("--tokenid <alias|id>", "The token's alias or id (see `b6p auth token list`)")
    .action(async (opts: { tokenid: string }) => {
      await withCore(
        globals(),
        async (ctx) => {
          await runMinting(ctx, async () => {
            const r = await ctx.core.gateway.tokens.rotate(opts.tokenid);
            printSecret(ctx, r.token.token);
            ctx.prompt.info(
              `Rotated token "${r.replaced.alias}": the old secret (id ${r.replaced.id}) is revoked; the new id is ${r.token.id}.`
            );
            if (r.rotatedCurrent) {
              ctx.prompt.info("That was the token b6p is using; the new secret has been stored for b6p.");
            }
            ctx.prompt.warn(STORE_NOW);
            ctx.emitJson({ ...r, secret: r.token.token });
          });
        },
        "Rotating token…"
      );
    });
}
