import * as fs from "fs/promises";
import type { Command } from "commander";
import type { SchemaRecipeName, SchemaTestResult } from "@bluestep-systems/b6p-core";
import { resolve, withCore, type CliContext, type GlobalOpts } from "../context";
import { writeStdout } from "../gatewayRun";
import { detectShellDialect } from "../pushOutcome";
import {
  SUPER_ONLY_LINE,
  applyExitCode,
  applyProblem,
  describeApplied,
  describeFindings,
  describePlan,
  describeVerdict,
  isForbidden,
  isNoChangeOnly,
  selectOrg,
  unknownULine,
  testExitCode,
  testProblem,
  toApplyJson,
  toTestJson,
  type OrgSelector,
  type SchemaGenerateJson,
  type SchemaRecipeJson,
} from "../schemaOutcome";

const ORG_HELP = "Any URL on the org to act on (its origin is used), e.g. https://org.example.com";
const U_HELP = "The org's U (U123456), resolved through b6p's U cache; the same org as --org";

/**
 * Adds the org selection every schema verb takes: exactly one of `--org` and `--u`.
 * @lastreviewed null
 */
function withOrgOptions(cmd: Command): Command {
  return cmd.option("--org <url>", ORG_HELP).option("--u <u>", U_HELP);
}

/**
 * The org URL a command acts on. A `--u` goes through core's org cache (a cache miss asks BlueHQ); one it cannot
 * resolve is reported and `undefined` returned.
 * @lastreviewed null
 */
async function resolveOrg(ctx: CliContext, selector: OrgSelector): Promise<string | undefined> {
  if (selector.flag === "--org") {
    return selector.value;
  }
  try {
    return (await ctx.core.orgCache.getAnyBaseUrl(selector.value)).origin;
  } catch (err) {
    ctx.logger.warn(`Resolving ${selector.value}: ${err instanceof Error ? err.message : err}`);
    ctx.fail(unknownULine(selector.value));
    return undefined;
  }
}

/**
 * The org a command was told to act on, or the usage error (commander prints it and exits `1`).
 * @lastreviewed null
 */
function orgOf(cmd: Command, opts: { org?: string; u?: string }): OrgSelector {
  const chosen = selectOrg(opts);
  if ("usageError" in chosen) {
    return cmd.error(chosen.usageError, { exitCode: 1 });
  }
  return chosen.selector;
}

/** The org options every schema verb takes. */
type OrgOpts = { org?: string; u?: string };
type GenerateOpts = OrgOpts & { portable?: boolean; closure: boolean; output?: string };

const RECIPES: readonly SchemaRecipeName[] = ["LINK_VIEW_GRANTS"];

const SCHEMA_HELP = `
Manifests are local YAML files. The schema commands are reserved to super users; every one takes exactly one of
--org <url> and --u <Uxxxxxx>.
The root flags --json and --verbose apply here, after "schema" too.

Exit codes:
  generate, recipe   0 done; 1 failed
  test               0 the gate passed (a plan that changes nothing included); 1 it did not
  apply              0 applied, or the gate passed and nothing changes; 1 the gate did not pass or the
                     server did not apply; 2 declined at the prompt (nothing applied)
`;

/**
 * The text of a manifest file, read as UTF-8.
 * @lastreviewed null
 */
async function readManifest(file: string): Promise<string> {
  return fs.readFile(resolve(file), "utf8");
}

/**
 * Runs a schema operation: a server that says this account is not a super user is reported as such (and, under
 * `--json`, as `error.kind` `SUPER_ONLY`); any other error goes to the top-level handler.
 * @lastreviewed null
 */
async function runSchema(ctx: CliContext, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (err) {
    if (!isForbidden(err)) {
      throw err;
    }
    ctx.emitJson({ error: { kind: "SUPER_ONLY", message: SUPER_ONLY_LINE, howTo: null } });
    ctx.fail(SUPER_ONLY_LINE);
  }
}

/**
 * Writes a manifest to `file`, or to stdout when there is none; under `--json` the body goes to stdout instead.
 * @lastreviewed null
 */
async function deliverManifest(ctx: CliContext, manifest: string, file: string | undefined): Promise<string | null> {
  if (file === undefined) {
    return null;
  }
  await fs.writeFile(resolve(file), manifest, "utf8");
  ctx.prompt.info(`Wrote ${manifest.length} characters to ${file}`);
  return file;
}

/**
 * Prints the gate verdict and plan of a test result to stdout.
 * @lastreviewed null
 */
function printPlan(ctx: CliContext, result: SchemaTestResult): void {
  const lines = [...describeVerdict(result), ...describePlan(result)];
  writeStdout(ctx, `${lines.join("\n")}\n`);
}

/**
 * Mount `b6p schema <verb>`: generate a manifest from objects, run a recipe, dry-run a manifest (`test`), and apply
 * it (`apply`: test, show the plan, confirm, apply). Super users only.
 * @lastreviewed null
 */
export function registerSchemaCommands(program: Command): void {
  const globals = () => program.opts<GlobalOpts>();
  const dialect = detectShellDialect();
  const schema = program
    .command("schema")
    .description("Generate, test and apply declarative schema manifests against an org (super users only)")
    .addHelpText("after", SCHEMA_HELP);

  withOrgOptions(schema.command("generate <ids...>"))
    .description("Write the manifest describing the named objects as they stand now (YAML to stdout, or -o FILE)")
    .option("--portable", "Generate a manifest holding no key, for applying in another tenant")
    .option("--no-closure", "Describe only the named objects, not every object of a supported kind they reference")
    .option("-o, --output <file>", "Write the manifest to this file instead of stdout")
    .action(async (ids: string[], opts: GenerateOpts, cmd: Command) => {
      const selector = orgOf(cmd, opts);
      await withCore(
        globals(),
        async (ctx) => {
          await runSchema(ctx, async () => {
            const org = await resolveOrg(ctx, selector);
            if (org === undefined) {
              return;
            }
            const manifest = await ctx.core.schema.generate(org, ids, {
              portable: opts.portable === true,
              closure: opts.closure,
            });
            const file = await deliverManifest(ctx, manifest, opts.output);
            if (ctx.globalOpts.json) {
              const body: SchemaGenerateJson = { manifest, file };
              ctx.emitJson(body);
            } else if (file === null) {
              writeStdout(ctx, manifest.endsWith("\n") ? manifest : `${manifest}\n`);
            }
          });
        },
        "Generating manifest…"
      );
    });

  withOrgOptions(schema.command("recipe <name>"))
    .description(`Run a recipe, an audit of the org stated as a manifest (${RECIPES.join(", ")})`)
    .option("-o, --output <file>", "Write the manifest to this file instead of stdout (findings go to stderr)")
    .action(async (name: string, opts: OrgOpts & { output?: string }, cmd: Command) => {
      const selector = orgOf(cmd, opts);
      await withCore(
        globals(),
        async (ctx) => {
          const recipe = RECIPES.find((r) => r === name.toUpperCase());
          if (recipe === undefined) {
            ctx.fail(`${name} is not a recipe this version knows. Use one of: ${RECIPES.join(", ")}.`);
            return;
          }
          await runSchema(ctx, async () => {
            const org = await resolveOrg(ctx, selector);
            if (org === undefined) {
              return;
            }
            const result = await ctx.core.schema.recipe(org, recipe);
            const file = await deliverManifest(ctx, result.manifest, opts.output);
            if (ctx.globalOpts.json) {
              const body: SchemaRecipeJson = { ...result, file };
              ctx.emitJson(body);
              return;
            }
            if (file === null) {
              writeStdout(ctx, result.manifest.endsWith("\n") ? result.manifest : `${result.manifest}\n`);
            }
            for (const line of describeFindings(result.findings)) {
              ctx.prompt.notice(line);
            }
          });
        },
        "Running recipe…"
      );
    });

  withOrgOptions(schema.command("test <file>"))
    .description("Dry-run a manifest: the gate's verdict, its refusals and the plan; nothing is written")
    .option("--verbose", "Also warn on objects of one kind that share a display name")
    .action(async (file: string, opts: OrgOpts & { verbose?: boolean }, cmd: Command) => {
      const selector = orgOf(cmd, opts);
      await withCore(
        globals(),
        async (ctx) => {
          await runSchema(ctx, async () => {
            const org = await resolveOrg(ctx, selector);
            if (org === undefined) {
              return;
            }
            const manifest = await readManifest(file);
            const result = await ctx.core.schema.test(org, manifest, { verbose: verboseFlag(opts, ctx) });
            if (ctx.globalOpts.json) {
              ctx.emitJson(toTestJson(result));
            } else {
              printPlan(ctx, result);
            }
            const problem = testProblem(result);
            if (problem !== null) {
              ctx.fail(problem.message);
            }
            process.exitCode = testExitCode(result);
          });
        },
        "Testing manifest…"
      );
    });

  withOrgOptions(schema.command("apply <file>"))
    .description("Test a manifest, show the plan, ask for a yes (or --confirm), then apply exactly what was tested")
    .option("--confirm", "Answer yes to the question: apply the plan without asking")
    .option("--verbose", "Also warn on objects of one kind that share a display name")
    .addHelpText(
      "after",
      `
The question defaults to No; an empty answer, or end of input with no --confirm, applies nothing. A plan that did not
pass is never asked about. The root --yes takes the default answer, which is No, so it declines here (exit 2);
--confirm is the flag that says yes.
`
    )
    .action(async (file: string, opts: OrgOpts & { verbose?: boolean; confirm?: boolean }, cmd: Command) => {
      const selector = orgOf(cmd, opts);
      await withCore(
        globals(),
        async (ctx) => {
          await runSchema(ctx, async () => {
            const org = await resolveOrg(ctx, selector);
            if (org === undefined) {
              return;
            }
            const manifest = await readManifest(file);
            const commandContext = { file, dialect, selector, confirm: opts.confirm === true };
            let shown = false;
            const outcome = await ctx.core.schema.testThenApply(
              org,
              manifest,
              async (result) => {
                shown = true;
                if (!ctx.globalOpts.json) {
                  printPlan(ctx, result);
                }
                if (isNoChangeOnly(result)) {
                  // Nothing to apply, so nothing to ask: not a decline.
                  return false;
                }
                if (opts.confirm === true) {
                  ctx.prompt.notice("Apply this plan? Yes  (answered by --confirm)");
                  return true;
                }
                return (await ctx.prompt.confirm("Apply this plan?", ["No", "Yes"])) === "Yes";
              },
              { verbose: verboseFlag(opts, ctx) }
            );
            const declined = outcome.declined && !isNoChangeOnly(outcome.test);
            if (!shown && !ctx.globalOpts.json) {
              printPlan(ctx, outcome.test);
            }
            if (outcome.apply !== null && outcome.apply.applied && !ctx.globalOpts.json) {
              writeStdout(ctx, `${describeApplied(outcome.apply).join("\n")}\n`);
            }
            if (ctx.globalOpts.json) {
              ctx.emitJson(toApplyJson(outcome.test, declined, outcome.apply, commandContext));
            }
            const problem = applyProblem(outcome.test, declined, outcome.apply, commandContext);
            if (problem !== null) {
              if (problem.kind === "DECLINED") {
                ctx.prompt.notice(problem.message);
              } else {
                ctx.fail(problem.message);
              }
              if (problem.howTo !== null) {
                ctx.prompt.notice(problem.howTo);
              }
            }
            process.exitCode = applyExitCode(outcome.test, declined, outcome.apply);
          });
        },
        "Testing manifest…"
      );
    });
}

/**
 * Whether the display-name warning was asked for: `--verbose` on the command, or the root flag.
 * @lastreviewed null
 */
function verboseFlag(opts: { verbose?: boolean }, ctx: CliContext): boolean | undefined {
  return opts.verbose === true || ctx.globalOpts.verbose === true ? true : undefined;
}
