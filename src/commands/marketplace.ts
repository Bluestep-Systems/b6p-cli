import type { Command } from "commander";
import { withCore, type GlobalOpts } from "../context";
import { formatTable, printResult, runGateway } from "../gatewayRun";

/**
 * Mount the global marketplace at `b6p marketplace <verb>`: list repos, pull a plain working
 * clone (both need `registry:read`) and create an empty repo (`registry:push`, a fleet super). There is no
 * push of its own: a created repo is pushed with plain git.
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

  market
    .command("create <name>")
    .description("Create an empty marketplace repository (needs registry:push and a fleet super user)")
    .option("--description <text>", "What the repository is for")
    .option("--website <url>", "Its website (an http or https URL)")
    .option("--topic <topic>", "A topic (repeat the option for several)", collectTopic, [] as string[])
    .action(async (name: string, opts: { description?: string; website?: string; topic: string[] }) => {
      await withCore(
        globals(),
        async (ctx) => {
          await runGateway(
            ctx,
            async () => {
              const { repo, created } = await ctx.core.gateway.marketplace.create({
                name,
                ...(opts.description === undefined ? {} : { description: opts.description }),
                ...(opts.website === undefined ? {} : { website: opts.website }),
                ...(opts.topic.length === 0 ? {} : { topics: opts.topic }),
              });
              const head = created
                ? `Created marketplace repository ${repo.name}`
                : `Adopted the existing empty marketplace repository ${repo.name} (nothing was created; an earlier attempt had left it empty)`;
              printResult(
                ctx,
                `${head}\nClone URL: ${repo.gitUrl}\n` +
                  `Next: push main alone first: \`git push ${repo.gitUrl} main\`, then its tags in a second push.\n` +
                  `It will not show in \`b6p marketplace list\` until that first push.`,
                { repo, created }
              );
            },
            { operation: "marketplace-create" }
          );
        },
        "Creating marketplace repository…"
      );
    });
}

/**
 * Commander accumulator for a repeatable option.
 * @lastreviewed null
 */
function collectTopic(value: string, previous: string[]): string[] {
  return [...previous, value];
}
