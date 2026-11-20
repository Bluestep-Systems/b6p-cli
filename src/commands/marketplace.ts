import type { Command } from "commander";
import type { GatewayMarketplaceRepo, GatewayMarketplaceRepoMetadata } from "@bluestep-systems/b6p-core";
import { withCore, type CliContext, type GlobalOpts } from "../context";
import { formatTable, printResult, runGateway } from "../gatewayRun";
import { NonInteractiveInputError } from "../providers/CliPrompt";

/**
 * Mount the global marketplace at `b6p marketplace <verb>`: list repos, show one and pull a plain working
 * clone (all `registry:read`), and manage a repo's lifecycle (`registry:push`, a fleet super): create, edit,
 * archive, unarchive, rename, delete (a tombstone), list tombstones and purge one (which also needs the
 * history-manager grant). There is no push of its own: a created repo is pushed with plain git.
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
                    ["NAME", "BRANCH", "TAGS", "ARCHIVED", "DESCRIPTION"],
                    repos.map((r) => [
                      r.name,
                      r.defaultBranch,
                      r.tags.join(","),
                      r.archived ? "archived" : "",
                      r.description,
                    ])
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

  market
    .command("get <name>")
    .description("Show one marketplace repository, empty ones included (a repository just created is not in `list`)")
    .action(async (name: string) => {
      await withCore(
        globals(),
        async (ctx) => {
          await runGateway(
            ctx,
            async () => {
              const repo = await ctx.core.gateway.marketplace.get(name);
              printResult(ctx, describeRepo(repo), { repo });
            },
            { operation: "marketplace-get", repo: name }
          );
        },
        "Reading marketplace repository…"
      );
    });

  market
    .command("edit <name>")
    .description(
      'Change a marketplace repository\'s description, website or topics; only the options given change (needs registry:push and a fleet super user). Pass an empty value (--description "" or --website "") to clear one'
    )
    .option("--description <text>", 'New description ("" clears it)')
    .option("--website <url>", 'New website, an http or https URL ("" clears it)')
    .option(
      "--topic <topic>",
      "Replace the topics with these (repeat the option for several)",
      collectTopic,
      [] as string[]
    )
    .option("--clear-topics", "Remove every topic")
    .action(
      async (
        name: string,
        opts: { description?: string; website?: string; topic: string[]; clearTopics?: boolean }
      ) => {
        await withCore(
          globals(),
          async (ctx) => {
            if (opts.clearTopics && opts.topic.length > 0) {
              ctx.fail("--clear-topics and --topic contradict each other: pass one. Nothing was changed.");
              return;
            }
            const metadata: GatewayMarketplaceRepoMetadata = {
              ...(opts.description === undefined ? {} : { description: opts.description }),
              ...(opts.website === undefined ? {} : { website: opts.website }),
              ...(opts.clearTopics ? { topics: [] } : opts.topic.length === 0 ? {} : { topics: opts.topic }),
            };
            if (Object.keys(metadata).length === 0) {
              ctx.fail(
                'Nothing to change: pass --description, --website, --topic or --clear-topics (an empty --description "" or --website "" clears that one).'
              );
              return;
            }
            await runGateway(
              ctx,
              async () => {
                const repo = await ctx.core.gateway.marketplace.edit(name, metadata);
                printResult(ctx, `Updated marketplace repository ${repo.name}\n${describeRepo(repo)}`, { repo });
              },
              { operation: "marketplace-edit", repo: name }
            );
          },
          "Editing marketplace repository…"
        );
      }
    );

  market
    .command("archive <name>")
    .description(
      "Archive a marketplace repository: it can still be cloned and fetched, but not pushed to, edited or renamed (needs registry:push and a fleet super user)"
    )
    .action(async (name: string) => {
      await withCore(
        globals(),
        async (ctx) => {
          await runGateway(
            ctx,
            async () => {
              const repo = await ctx.core.gateway.marketplace.archive(name);
              printResult(
                ctx,
                `Archived marketplace repository ${repo.name}. It can still be cloned and fetched; pushing, editing and renaming are refused until \`b6p marketplace unarchive ${repo.name}\`.`,
                { repo }
              );
            },
            { operation: "marketplace-archive", repo: name }
          );
        },
        "Archiving marketplace repository…"
      );
    });

  market
    .command("unarchive <name>")
    .description(
      "Unarchive a marketplace repository, so it can be pushed to, edited and renamed again (needs registry:push and a fleet super user)"
    )
    .action(async (name: string) => {
      await withCore(
        globals(),
        async (ctx) => {
          await runGateway(
            ctx,
            async () => {
              const repo = await ctx.core.gateway.marketplace.unarchive(name);
              printResult(
                ctx,
                `Unarchived marketplace repository ${repo.name}. It can be pushed to, edited and renamed again.`,
                {
                  repo,
                }
              );
            },
            { operation: "marketplace-unarchive", repo: name }
          );
        },
        "Unarchiving marketplace repository…"
      );
    });

  market
    .command("rename <name> <new-name>")
    .description(
      "Rename a marketplace repository; clones of the old URL keep working through a redirect (needs registry:push and a fleet super user)"
    )
    .action(async (name: string, newName: string) => {
      await withCore(
        globals(),
        async (ctx) => {
          await runGateway(
            ctx,
            async () => {
              const repo = await ctx.core.gateway.marketplace.rename(name, newName);
              printResult(
                ctx,
                `Renamed marketplace repository ${name} to ${repo.name}\n` +
                  `Clone URL: ${repo.gitUrl}\n` +
                  `Existing clones keep working: the gateway redirects git requests for the old URL to the new one. ` +
                  `Point a clone at the new URL with:\n  git remote set-url origin ${repo.gitUrl}\n` +
                  `The old name is not found by b6p, and its npm packages are not affected.`,
                { repo, previousName: name }
              );
            },
            { operation: "marketplace-rename", repo: name }
          );
        },
        "Renaming marketplace repository…"
      );
    });

  market
    .command("delete <name>")
    .description(
      "Delete a marketplace repository: it is renamed to an archived tombstone, nothing is destroyed (needs registry:push and a fleet super user). Asks you to type the name, or pass --yes"
    )
    .action(async (name: string) => {
      await withCore(
        globals(),
        async (ctx) => {
          const warning =
            `This deletes marketplace repository ${name}: it is renamed to an archived tombstone and disappears from ` +
            `\`list\`, and git clients using its URL get 404. Nothing is destroyed; \`b6p marketplace purge\` does that.`;
          if (!(await confirmByTyping(ctx, { warning, expected: name, yesAccepted: true, verb: "delete" }))) {
            return;
          }
          await runGateway(
            ctx,
            async () => {
              const tombstone = await ctx.core.gateway.marketplace.delete(name);
              printResult(
                ctx,
                `Deleted marketplace repository ${name}. It is kept as the archived tombstone ${tombstone}; ` +
                  `nothing was destroyed (history, tags and npm packages stay), and the name ${name} is free for \`b6p marketplace create\` again.\n` +
                  `To destroy it for good: \`b6p marketplace purge ${tombstone}\` (irreversible; needs the history-manager grant).`,
                { name, tombstone }
              );
            },
            { operation: "marketplace-delete", repo: name }
          );
        },
        "Deleting marketplace repository…"
      );
    });

  market
    .command("tombstones")
    .description("List deleted marketplace repositories awaiting a purge (needs registry:push and a fleet super user)")
    .action(async () => {
      await withCore(
        globals(),
        async (ctx) => {
          await runGateway(
            ctx,
            async () => {
              const tombstones = await ctx.core.gateway.marketplace.tombstones();
              const human =
                tombstones.length === 0
                  ? "No deleted marketplace repositories."
                  : formatTable(
                      ["TOMBSTONE", "NAME", "ID", "ARCHIVED"],
                      tombstones.map((t) => [t.tombstone, t.deletedName, String(t.id), t.archived ? "yes" : "no"])
                    );
              printResult(ctx, human, { tombstones });
            },
            { operation: "marketplace-tombstones" }
          );
        },
        "Listing deleted marketplace repositories…"
      );
    });

  market
    .command("purge <tombstone>")
    .description(
      "Destroy a deleted marketplace repository, history and tags with it, for good (needs registry:push, a fleet super user and the history-manager grant). Asks you to type the tombstone name, or pass --confirm-purge"
    )
    .option("--confirm-purge", "Go ahead without asking (--yes alone never purges)")
    .action(async (tombstone: string, opts: { confirmPurge?: boolean }) => {
      await withCore(
        globals(),
        async (ctx) => {
          const warning =
            `This destroys ${tombstone} for good: its history and tags are deleted from the forge. ` +
            `There is no undo and no waiting period, and the purge is audited.`;
          const go = await confirmByTyping(ctx, {
            warning,
            expected: tombstone,
            yesAccepted: false,
            confirmFlag: { name: "--confirm-purge", given: opts.confirmPurge === true },
            verb: "purge",
          });
          if (!go) {
            return;
          }
          await runGateway(
            ctx,
            async () => {
              await ctx.core.gateway.marketplace.purge(tombstone);
              printResult(ctx, `Purged ${tombstone}. Its history and tags are gone for good.`, { purged: tombstone });
            },
            { operation: "marketplace-purge", repo: tombstone }
          );
        },
        "Purging marketplace repository…"
      );
    });
}

/**
 * The lines that describe one repository.
 * @lastreviewed null
 */
function describeRepo(repo: GatewayMarketplaceRepo): string {
  const or = (v: string): string => (v === "" ? "(none)" : v);
  return [
    `  name:           ${repo.name}`,
    `  description:    ${or(repo.description)}`,
    `  website:        ${or(repo.website)}`,
    `  topics:         ${or(repo.topics.join(", "))}`,
    `  archived:       ${repo.archived ? "yes" : "no"}`,
    `  default branch: ${repo.defaultBranch}`,
    `  tags:           ${or(repo.tags.join(", "))}`,
    `  clone URL:      ${repo.gitUrl}`,
  ].join("\n");
}

/**
 * How a destructive command is confirmed. In order:
 * - `confirmFlag` given (a command's own flag, such as `--confirm-purge`): go ahead, saying so;
 * - the global `--yes`: goes ahead only when `yesAccepted`; otherwise it is refused, as `kb --access public`
 *   refuses it (`--yes` alone never does the irreversible thing);
 * - otherwise the user types `expected` back. Anything else, or no input to read (no TTY and nothing piped), is a
 *   refusal.
 *
 * Returns whether to go on; says why not through `ctx.fail`, with nothing sent to the gateway.
 * @lastreviewed null
 */
async function confirmByTyping(
  ctx: CliContext,
  opts: {
    warning: string;
    expected: string;
    yesAccepted: boolean;
    confirmFlag?: { name: string; given: boolean };
    verb: string;
  }
): Promise<boolean> {
  const { warning, expected, yesAccepted, confirmFlag, verb } = opts;
  if (confirmFlag?.given) {
    ctx.prompt.warn(`${warning} Going ahead because ${confirmFlag.name} was passed.`);
    return true;
  }
  if (ctx.globalOpts.yes) {
    if (yesAccepted) {
      ctx.prompt.warn(`${warning} Going ahead because --yes was passed.`);
      return true;
    }
    ctx.fail(
      `${warning}\n--yes alone never does this. Pass ${confirmFlag?.name ?? "the command's own flag"} to ${verb} it. Nothing was ${verb}d.`
    );
    return false;
  }
  const how = confirmFlag === undefined ? "--yes" : confirmFlag.name;
  let answer: string | undefined;
  try {
    answer = await ctx.prompt.inputBox({
      prompt: `${warning}\nType ${expected} to ${verb} it (anything else cancels)`,
    });
  } catch (err) {
    if (err instanceof NonInteractiveInputError) {
      ctx.fail(`There is no terminal to ask in, so nothing was ${verb}d. Pass ${how} to ${verb} without asking.`);
      return false;
    }
    throw err;
  }
  if (answer?.trim() !== expected) {
    ctx.fail(`Cancelled: nothing was ${verb}d.`);
    return false;
  }
  return true;
}

/**
 * Commander accumulator for a repeatable option.
 * @lastreviewed null
 */
function collectTopic(value: string, previous: string[]): string[] {
  return [...previous, value];
}
