import * as path from "node:path";
import type { Command } from "commander";
import { findCloneRoot } from "../cloneRoot";
import { withCore, type GlobalOpts } from "../context";
import { formatTable, printResult, runGateway } from "../gatewayRun";

/**
 * Mount knowledge bases at `b6p kb <verb>`: list what the stored gateway token may read, pull one
 * into a folder, push a folder back. Needs the `kb:read` scope (and `kb:push` to push).
 * @lastreviewed null
 */
export function registerKbCommands(program: Command): void {
  const globals = () => program.opts<GlobalOpts>();
  const kb = program.command("kb").description("Browse, pull and push knowledge bases through the gateway");

  kb.command("list")
    .description("List the knowledge bases you may read")
    .option("--scope <scope>", "Only global or only tenant knowledge bases")
    .option("--tenant <tenant>", "Only this tenant's knowledge bases (e.g. U142133)")
    .action(async (opts: { scope?: string; tenant?: string }) => {
      await withCore(
        globals(),
        async (ctx) => {
          if (opts.scope !== undefined && opts.scope !== "global" && opts.scope !== "tenant") {
            ctx.fail(`--scope ${opts.scope} is not understood. Use global or tenant.`);
            return;
          }
          const scope = opts.scope as "global" | "tenant" | undefined;
          await runGateway(ctx, async () => {
            const list = await ctx.core.gateway.kb.list({ scope, tenant: opts.tenant });
            const human =
              list.length === 0
                ? "No knowledge bases."
                : formatTable(
                    ["REF", "TITLE", "BRANCH", "PUSH"],
                    list.map((k) => [k.ref, k.title, k.liveBranch, k.canPush ? "yes" : "no"])
                  );
            printResult(ctx, human, { knowledgeBases: list });
          });
        },
        "Listing knowledge bases…"
      );
    });

  kb.command("pull <ref> [dir]")
    .description("Clone a knowledge base into a folder, or fast-forward an existing clone (<name> or U<tenant>/<name>)")
    .action(async (ref: string, dir: string | undefined) => {
      await withCore(
        globals(),
        async (ctx) => {
          await runGateway(ctx, async () => {
            const r = await ctx.core.gateway.kb.pull(ref, { cwd: process.cwd(), dir });
            const verb: Record<typeof r.outcome, string> = {
              cloned: "Cloned",
              "fast-forwarded": "Updated",
              "up-to-date": "Already up to date:",
              ahead: "Nothing to pull (your copy has unpushed commits):",
            };
            const branch = r.branch ?? "(detached)";
            printResult(ctx, `${verb[r.outcome]} ${r.kb.ref} in ${r.dir} (${branch} at ${r.to.slice(0, 7)})`, r);
          });
        },
        "Pulling knowledge base…"
      );
    });

  kb.command("push [dir]")
    .description(
      "Push the knowledge base clone in a folder (default: here, or the clone containing it) to its live branch"
    )
    .action(async (dir: string | undefined) => {
      await withCore(
        globals(),
        async (ctx) => {
          await runGateway(ctx, async () => {
            const r = await ctx.core.gateway.kb.push(findCloneRoot(path.resolve(process.cwd(), dir ?? ".")), {
              cwd: process.cwd(),
            });
            printResult(
              ctx,
              r.pushed
                ? `Pushed ${r.commit.slice(0, 7)} to ${r.ref}`
                : `Nothing to push: ${r.ref} is already at ${r.commit.slice(0, 7)}`,
              r
            );
          });
        },
        "Pushing knowledge base…"
      );
    });
}
