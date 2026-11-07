import type { Command } from "commander";
import { withCore, type GlobalOpts } from "../context";
import { formatTable, printResult, runGateway } from "../gatewayRun";

/**
 * Mount the global marketplace at `b6p marketplace <verb>`: list repos and pull a plain working
 * clone. Needs the `registry:read` scope. There is no push.
 * @lastreviewed null
 */
export function registerMarketplaceCommands(program: Command): void {
  const globals = () => program.opts<GlobalOpts>();
  const market = program.command("marketplace").description("Browse and pull marketplace repositories");

  market
    .command("list")
    .description("List marketplace repositories and their tags")
    .action(async () => {
      await withCore(
        globals(),
        async (ctx) => {
          await runGateway(ctx, async () => {
            const repos = await ctx.core.gateway.marketplace.list();
            const human =
              repos.length === 0
                ? "No marketplace repositories."
                : formatTable(
                    ["NAME", "BRANCH", "TAGS", "DESCRIPTION"],
                    repos.map((r) => [r.name, r.defaultBranch, r.tags.join(","), r.description])
                  );
            printResult(ctx, human, { repos });
          });
        },
        "Listing marketplace…"
      );
    });

  market
    .command("pull <name> [dir]")
    .description("Clone a marketplace repository into a folder (default ./<name>), or fast-forward an existing clone")
    .option(
      "--ref <ref>",
      "A tag or branch to check out, short or full name such as refs/tags/v1.0.0 (default: the repository's default branch)"
    )
    .action(async (name: string, dir: string | undefined, opts: { ref?: string }) => {
      await withCore(
        globals(),
        async (ctx) => {
          await runGateway(ctx, async () => {
            const r = await ctx.core.gateway.marketplace.pull(name, { cwd: process.cwd(), dir, ref: opts.ref });
            const verb: Record<typeof r.action, string> = {
              cloned: "Cloned",
              "fast-forwarded": "Updated",
              "up-to-date": "Already up to date:",
              ahead: "Nothing to pull (your copy has unpushed commits):",
            };
            printResult(ctx, `${verb[r.action]} ${r.name} in ${r.dir} (${r.ref} at ${r.head.slice(0, 7)})`, r);
          });
        },
        "Pulling marketplace repository…"
      );
    });
}
