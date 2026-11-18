import * as fs from "fs/promises";
import type { Command } from "commander";
import type { SchemaRecipeName, SchemaTestResult } from "@bluestep-systems/b6p-core";
import { resolve, withCore, type CliContext, type GlobalOpts } from "../context";
import { writeStdout } from "../gatewayRun";
import { detectShellDialect } from "../pushOutcome";
import {
  SUPER_ONLY_LINE,
  applyExitCode,
  applyOutcomeUnknown,
  applyProblem,
  describeApplied,
  describeFindings,
  describePlan,
  describeVerdict,
  isForbidden,
  isNoChangeOnly,
  isServerTooOld,
  manifestUnreadableProblem,
  orgLookupProblem,
  raiseExitCode,
  selectOrg,
  serverTooOldProblem,
  testExitCode,
  testProblem,
  toApplyJson,
  toTestJson,
  unknownRecipeProblem,
  withTrailingNewline,
  type OrgSelector,
  type SchemaCommandFamily,
  type SchemaGenerateJson,
  type SchemaRecipeJson,
} from "../schemaOutcome";
import { checkOutput, reportFailure } from "../schemaRun";

const ORG_HELP = "Any URL on the org to act on (its origin is used), e.g. https://org.example.com";
const U_HELP = "The org's U (U123456), resolved through b6p's U cache; the same org as --org";
const WARN_NAMES_HELP = "Also warn on objects of one kind that share a display name";

/**
 * The org options every schema verb takes.
 * @lastreviewed null
 */
type OrgOpts = { org?: string; u?: string };

/**
 * The options of `schema generate`.
 * @lastreviewed null
 */
type GenerateOpts = OrgOpts & { portable?: boolean; closure: boolean; output?: string };

/**
 * The recipes `schema recipe` knows.
 * @lastreviewed null
 */
const RECIPES: readonly SchemaRecipeName[] = ["LINK_VIEW_GRANTS"];

const SCHEMA_HELP = `
Manifests are local YAML files. The schema commands are reserved to super users; every one takes exactly one of
--org <url> and --u <Uxxxxxx>. The root flag --json applies here, after "schema" too.

Exit codes:
  generate, recipe   0 done; 1 failed
  test               0 the gate passed (a plan that changes nothing included); 1 it did not
  apply              0 applied, or the gate passed and nothing changes; 1 the gate did not pass or the
                     server did not apply; 2 declined at the prompt (nothing applied)
`;

/**
 * Adds the org selection every schema verb takes: exactly one of `--org` and `--u`.
 * @lastreviewed null
 */
function withOrgOptions(cmd: Command): Command {
  return cmd.option("--org <url>", ORG_HELP).option("--u <u>", U_HELP);
}

/**
 * The org URL a command acts on. A `--u` goes through core's org cache (a cache miss asks BlueHQ); one it cannot
 * resolve is reported as the command's failure and `undefined` returned.
 * @lastreviewed null
 */
async function resolveOrg(
  ctx: CliContext,
  family: SchemaCommandFamily,
  selector: OrgSelector
): Promise<string | undefined> {
  if (selector.flag === "--org") {
    return selector.value;
  }
  try {
    return (await ctx.core.orgCache.getAnyBaseUrl(selector.value)).origin;
  } catch (err) {
    reportFailure(ctx, family, orgLookupProblem(selector.value, err));
    return undefined;
  }
}

/**
 * The org a command was told to act on, or the usage error (commander prints it and exits `1`).
 * @lastreviewed null
 */
function orgOf(cmd: Command, opts: OrgOpts): OrgSelector {
  const chosen = selectOrg(opts);
  if ("usageError" in chosen) {
    return cmd.error(chosen.usageError, { exitCode: 1 });
  }
  return chosen.selector;
}

/**
 * The text of a manifest file, or `undefined` once the failure is reported.
 * @lastreviewed null
 */
async function readManifest(ctx: CliContext, family: SchemaCommandFamily, file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(resolve(file), "utf8");
  } catch (err) {
    reportFailure(ctx, family, manifestUnreadableProblem(file, err));
    return undefined;
  }
}

/**
 * Runs a schema operation. A server that says this account is not a super user, or that predates the feature, is
 * reported as the command's failure (in its `--json` shape too); any other error goes to the top-level handler.
 * @lastreviewed null
 */
async function runSchema(ctx: CliContext, family: SchemaCommandFamily, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (err) {
    if (isForbidden(err)) {
      reportFailure(ctx, family, { kind: "SUPER_ONLY", message: SUPER_ONLY_LINE, howTo: null });
    } else if (isServerTooOld(err)) {
      reportFailure(ctx, family, serverTooOldProblem(err));
    } else {
      throw err;
    }
  }
}

/**
 * Writes a manifest to `file`; returns the file, or `null` when there is none.
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
 * Sets the process exit code to `wanted`, never lowering one a reported failure already set.
 * @lastreviewed null
 */
function exitWith(wanted: number): void {
  process.exitCode = raiseExitCode(process.exitCode, wanted);
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
    .option("-o, --output <file>", "Write the manifest to this file instead of stdout (asks before replacing one)")
    .action(async (ids: string[], opts: GenerateOpts, cmd: Command) => {
      const selector = orgOf(cmd, opts);
      await withCore(
        globals(),
        async (ctx) => {
          await runSchema(ctx, "generate", async () => {
            if (!(await checkOutput(ctx, "generate", opts.output))) {
              return;
            }
            const org = await resolveOrg(ctx, "generate", selector);
            if (org === undefined) {
              return;
            }
            const manifest = await ctx.core.schema.generate(org, ids, {
              portable: opts.portable === true,
              closure: opts.closure,
            });
            const file = await deliverManifest(ctx, manifest, opts.output);
            if (ctx.globalOpts.json) {
              const body: SchemaGenerateJson = { manifest, file, error: null };
              ctx.emitJson(body);
            } else if (file === null) {
              writeStdout(ctx, withTrailingNewline(manifest));
            }
          });
        },
        "Generating manifest…"
      );
    });

  withOrgOptions(schema.command("recipe <name>"))
    .description(`Run a recipe, an audit of the org stated as a manifest (${RECIPES.join(", ")})`)
    .option(
      "-o, --output <file>",
      "Write the manifest to this file instead of stdout (findings go to stderr; asks before replacing one)"
    )
    .action(async (name: string, opts: OrgOpts & { output?: string }, cmd: Command) => {
      const selector = orgOf(cmd, opts);
      await withCore(
        globals(),
        async (ctx) => {
          await runSchema(ctx, "recipe", async () => {
            const recipe = RECIPES.find((r) => r === name.toUpperCase());
            if (recipe === undefined) {
              reportFailure(ctx, "recipe", unknownRecipeProblem(name, RECIPES));
              return;
            }
            if (!(await checkOutput(ctx, "recipe", opts.output))) {
              return;
            }
            const org = await resolveOrg(ctx, "recipe", selector);
            if (org === undefined) {
              return;
            }
            const result = await ctx.core.schema.recipe(org, recipe);
            const file = await deliverManifest(ctx, result.manifest, opts.output);
            if (ctx.globalOpts.json) {
              const body: SchemaRecipeJson = { ...result, file, error: null };
              ctx.emitJson(body);
              return;
            }
            if (file === null) {
              writeStdout(ctx, withTrailingNewline(result.manifest));
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
    .option("--warn-names", WARN_NAMES_HELP)
    .action(async (file: string, opts: OrgOpts & { warnNames?: boolean }, cmd: Command) => {
      const selector = orgOf(cmd, opts);
      await withCore(
        globals(),
        async (ctx) => {
          await runSchema(ctx, "test", async () => {
            const manifest = await readManifest(ctx, "test", file);
            const org = manifest === undefined ? undefined : await resolveOrg(ctx, "test", selector);
            if (manifest === undefined || org === undefined) {
              return;
            }
            const result = await ctx.core.schema.test(org, manifest, { verbose: opts.warnNames === true || undefined });
            if (ctx.globalOpts.json) {
              ctx.emitJson(toTestJson(result));
            } else {
              printPlan(ctx, result);
            }
            const problem = testProblem(result);
            if (problem !== null) {
              ctx.fail(problem.message);
            }
            exitWith(testExitCode(result));
          });
        },
        "Testing manifest…"
      );
    });

  withOrgOptions(schema.command("apply <file>"))
    .description("Test a manifest, show the plan, ask for a yes (or --confirm), then apply exactly what was tested")
    .option("--confirm", "Answer yes to the question: apply the plan without asking")
    .option("--warn-names", WARN_NAMES_HELP)
    .addHelpText(
      "after",
      `
The question defaults to No; an empty answer, or end of input with no --confirm, applies nothing. A plan that did not
pass is never asked about. The root --yes takes the default answer, which is No, so it declines here (exit 2);
--confirm is the flag that says yes.
`
    )
    .action(async (file: string, opts: OrgOpts & { warnNames?: boolean; confirm?: boolean }, cmd: Command) => {
      const selector = orgOf(cmd, opts);
      await withCore(
        globals(),
        async (ctx) => {
          await runSchema(ctx, "apply", async () => {
            const manifest = await readManifest(ctx, "apply", file);
            const org = manifest === undefined ? undefined : await resolveOrg(ctx, "apply", selector);
            if (manifest === undefined || org === undefined) {
              return;
            }
            const commandContext = { file, dialect, selector, confirm: opts.confirm === true };
            let shown = false;
            let confirmed = false;
            let shownPlan: SchemaTestResult | undefined;
            let outcome;
            try {
              outcome = await ctx.core.schema.testThenApply(
                org,
                manifest,
                async (result) => {
                  shown = true;
                  shownPlan = result;
                  if (!ctx.globalOpts.json) {
                    printPlan(ctx, result);
                  }
                  if (isNoChangeOnly(result)) {
                    // Nothing to apply, so nothing to ask: not a decline.
                    return false;
                  }
                  if (opts.confirm === true) {
                    ctx.prompt.notice("Apply this plan? Yes  (answered by --confirm)");
                    confirmed = true;
                  } else {
                    confirmed = (await ctx.prompt.confirm("Apply this plan?", ["No", "Yes"])) === "Yes";
                  }
                  return confirmed;
                },
                { verbose: opts.warnNames === true || undefined }
              );
            } catch (err) {
              // Once the caller said yes, an error that is not a refusal says nothing about whether the apply went
              // through: the key is spent and the request may have arrived.
              if (confirmed && !isForbidden(err) && !isServerTooOld(err)) {
                reportFailure(ctx, "apply", applyOutcomeUnknown(err, commandContext), shownPlan);
                return;
              }
              throw err;
            }
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
            exitWith(applyExitCode(outcome.test, declined, outcome.apply));
          });
        },
        "Testing manifest…"
      );
    });
}
