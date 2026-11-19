import * as path from "node:path";
import { Err } from "@bluestep-systems/b6p-core";
import type {
  GatewayKnowledgeBase,
  GatewayKnowledgeBaseAccess,
  GatewayKnowledgeBaseDetail,
  GatewayKnowledgeBaseStatus,
} from "@bluestep-systems/b6p-core";
import type { Command } from "commander";
import { findCloneRoot } from "../cloneRoot";
import { withCore, type CliContext, type GlobalOpts } from "../context";
import { formatTable, printResult, runGateway } from "../gatewayRun";
import { kbPullHint } from "../gitSetupRun";

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
 * Parse a `--access` value. `undefined` is "not given".
 * @lastreviewed null
 */
export function parseAccess(
  raw: string | undefined
): { ok: true; access: "public" | "private" | undefined } | { ok: false; message: string } {
  if (raw === undefined || raw === "public" || raw === "private") {
    return { ok: true, access: raw };
  }
  return { ok: false, message: `--access ${raw} is not understood. Use public or private.` };
}

/**
 * The warning shown before a knowledge base is made public.
 * @lastreviewed null
 */
export function publicWarning(name: string): string {
  return `Anyone on the internet will be able to read ${name} with no sign-in: every commit reachable from its live branch, including files since deleted from it. Anything that was ever committed there becomes public.`;
}

/**
 * Before a knowledge base becomes public. `--confirm-public` goes ahead (and says so). Otherwise the user is
 * asked, Cancel being the default. The global `--yes` never confirms this: with it, nothing is asked and the
 * answer is no. Returns whether to go on; says why not through `ctx.fail`.
 * @lastreviewed null
 */
async function confirmPublic(ctx: CliContext, name: string, confirmed: boolean | undefined): Promise<boolean> {
  const warning = publicWarning(name);
  if (confirmed) {
    ctx.prompt.warn(`${warning} Making it public because --confirm-public was passed.`);
    return true;
  }
  if (ctx.globalOpts.yes) {
    ctx.fail(`${warning}\n--yes alone never makes a knowledge base public. Pass --confirm-public to do it.`);
    return false;
  }
  const cancel = "Cancel";
  const publish = `Make ${name} public`;
  const answer = await ctx.prompt.confirm(`${warning} Make it public?`, [cancel, publish], {
    destructive: true,
    safeOption: cancel,
  });
  if (answer !== publish) {
    ctx.fail(`Cancelled: ${name} was not made public.`);
    return false;
  }
  return true;
}

/**
 * The access line of a result. A gateway that sent none (one that predates public knowledge bases) is "not
 * reported", and a kind this version does not know is "unknown": never "public".
 * @lastreviewed null
 */
export function accessText(access: GatewayKnowledgeBaseAccess | undefined): string {
  if (access === undefined) {
    return "not reported (the gateway predates public knowledge bases)";
  }
  return access.kind === "unknown" ? "unknown (a kind this version does not know; treat it as private)" : access.kind;
}

/**
 * The lines printed after a create or change.
 * @lastreviewed null
 */
export function describeDetail(d: GatewayKnowledgeBaseDetail): string {
  return [
    `  ref:    ${d.ref}`,
    `  title:  ${d.title}`,
    `  branch: ${d.liveBranch}`,
    `  access: ${accessText(d.access)}`,
  ].join("\n");
}

/**
 * Report an access change the gateway did not confirm: it sent no `access` back, so the knowledge base's
 * access cannot be said to have changed.
 * @lastreviewed null
 */
function unconfirmedAccess(
  ctx: CliContext,
  d: GatewayKnowledgeBaseDetail,
  asked: "public" | "private" | undefined
): void {
  if (asked !== undefined && d.access === undefined) {
    ctx.fail(
      `The gateway did not report ${d.ref}'s access, so b6p cannot say it is ${asked}. It may predate public knowledge bases; check with \`b6p kb list\` after it is updated.`
    );
  }
}

/**
 * Mount knowledge bases at `b6p kb <verb>`: list what the stored gateway token may read, pull one
 * into a folder, push a folder back, register one and change its title, live branch or access.
 * Needs the `kb:read` scope (`kb:push` to push, `kb:manage` to create, and to change a knowledge base in `set`, which reads it with `kb:read`).
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
            if (r.outcome === "cloned") {
              await kbPullHint(ctx, r.dir);
            }
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

  kb.command("create <name>")
    .description("Register a global knowledge base (needs kb:manage and a super user)")
    .option("--title <title>", "Its title (default: the name)")
    .option("--live-branch <branch>", "Its live branch (default: main)")
    .option("--access <access>", "public (anyone, signed out, may read it) or private (the default)")
    .option("--confirm-public", "Go ahead with --access public without asking (--yes alone never does)")
    .action(
      async (name: string, opts: { title?: string; liveBranch?: string; access?: string; confirmPublic?: boolean }) => {
        await withCore(
          globals(),
          async (ctx) => {
            const access = parseAccess(opts.access);
            if (!access.ok) {
              ctx.fail(access.message);
              return;
            }
            if (access.access === "public" && !(await confirmPublic(ctx, name, opts.confirmPublic))) {
              return;
            }
            await runGateway(ctx, async () => {
              const created = await ctx.core.gateway.kb.create({
                name,
                title: opts.title,
                liveBranch: opts.liveBranch,
                ...(access.access === undefined ? {} : { access: { kind: access.access } }),
              });
              printResult(ctx, `Created ${created.ref}\n${describeDetail(created)}`, { knowledgeBase: created });
              unconfirmedAccess(ctx, created, access.access);
            });
          },
          "Creating knowledge base…"
        );
      }
    );

  kb.command("set <name>")
    .description(
      "Change a global knowledge base's title, live branch or access (needs kb:read to find it, kb:manage to change it, and a super user)"
    )
    .option("--title <title>", "A new title")
    .option("--live-branch <branch>", "A new live branch")
    .option("--access <access>", "public (anyone, signed out, may read it) or private")
    .option("--confirm-public", "Go ahead with --access public without asking (--yes alone never does)")
    .action(
      async (name: string, opts: { title?: string; liveBranch?: string; access?: string; confirmPublic?: boolean }) => {
        await withCore(
          globals(),
          async (ctx) => {
            const access = parseAccess(opts.access);
            if (!access.ok) {
              ctx.fail(access.message);
              return;
            }
            if (opts.title === undefined && opts.liveBranch === undefined && access.access === undefined) {
              ctx.fail("Nothing to change. Pass at least one of --title, --live-branch or --access.");
              return;
            }
            await runGateway(ctx, async () => {
              const { kb: detail, etag } = await ctx.core.gateway.kb.read(name);
              const want = {
                title: opts.title !== undefined && opts.title !== detail.title ? opts.title : undefined,
                liveBranch:
                  opts.liveBranch !== undefined && opts.liveBranch !== detail.liveBranch ? opts.liveBranch : undefined,
                access:
                  access.access !== undefined && access.access !== detail.access?.kind ? access.access : undefined,
              };
              if (want.title === undefined && want.liveBranch === undefined && want.access === undefined) {
                printResult(ctx, `${detail.ref} is already as asked; nothing changed.\n${describeDetail(detail)}`, {
                  knowledgeBase: detail,
                  changed: false,
                });
                return;
              }
              if (want.access === "public" && !(await confirmPublic(ctx, detail.name, opts.confirmPublic))) {
                return;
              }
              const changed = await ctx.core.gateway.kb.update(detail.id, etag, {
                title: want.title,
                liveBranch: want.liveBranch,
                ...(want.access === undefined ? {} : { access: { kind: want.access } }),
              });
              printResult(ctx, `Updated ${changed.ref}\n${describeDetail(changed)}`, {
                knowledgeBase: changed,
                changed: true,
              });
              unconfirmedAccess(ctx, changed, want.access);
            });
          },
          "Changing knowledge base…"
        );
      }
    );
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
