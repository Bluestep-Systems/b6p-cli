import * as path from "node:path";
import { Err } from "@bluestep-systems/b6p-core";
import type { GatewayKnowledgeBase, GatewayKnowledgeBaseStatus } from "@bluestep-systems/b6p-core";
import type { Command } from "commander";
import { findCloneRoot } from "../cloneRoot";
import { withCore, type GlobalOpts } from "../context";
import { formatTable, printResult, runGateway } from "../gatewayRun";

/**
 * One sentence per non-ok status, printed once after the table when any listed row has it.
 * @lastreviewed null
 */
const STATUS_NOTES: Partial<Record<GatewayKnowledgeBaseStatus, string>> = {
  undescribed: "pass --tenant <U…> for titles and status from the tenant",
  unconfirmed: "the tenant's server did not answer; details may be stale, retry later",
  "row-only": "no repository yet; it cannot be pulled until it is created",
  "repo-only": "no matching knowledge base record in the tenant",
  "branch-mismatch": "the live branch shown is the forge's default branch, which differs from the tenant's setting",
};

/**
 * The notes under a listing: one line per non-ok status present, in the order of {@link STATUS_NOTES}.
 * An unknown status is named by its raw value.
 * @lastreviewed null
 */
export function statusNotes(list: GatewayKnowledgeBase[]): string[] {
  const present = new Set(list.map((k) => k.status));
  const notes = (Object.keys(STATUS_NOTES) as GatewayKnowledgeBaseStatus[])
    .filter((status) => present.has(status))
    .map((status) => `${status}: ${STATUS_NOTES[status]}`);
  const raws = [...new Set(list.filter((k) => k.status === "unknown").map((k) => k.rawStatus ?? "?"))];
  for (const raw of raws) {
    notes.push(`${raw}: a status this version does not know; update b6p`);
  }
  return notes;
}

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
                    ["REF", "TITLE", "BRANCH", "PUSH", "STATUS"],
                    list.map((k) => [k.ref, k.title, k.liveBranch, k.canPush ? "yes" : "no", k.rawStatus ?? k.status])
                  );
            const notes = statusNotes(list);
            printResult(ctx, notes.length === 0 ? human : `${human}\n\n${notes.join("\n")}`, { knowledgeBases: list });
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
            let r;
            try {
              r = await ctx.core.gateway.kb.pull(ref, { cwd: process.cwd(), dir });
            } catch (err) {
              if (err instanceof Err.GatewayNotFoundError && (await isRowOnly(ctx.core.gateway.kb, ref))) {
                ctx.fail(
                  `${ref} has no repository yet, so there is nothing to pull. It can be pulled once its repository is created.`
                );
                return;
              }
              throw err;
            }
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

/**
 * Whether the listing shows `ref` as a record whose repository does not exist yet. Any failure of the
 * lookup answers false, so the original not-found is reported instead.
 * @lastreviewed null
 */
async function isRowOnly(kb: { resolve(ref: string): Promise<GatewayKnowledgeBase> }, ref: string): Promise<boolean> {
  try {
    return (await kb.resolve(ref)).status === "row-only";
  } catch {
    return false;
  }
}
