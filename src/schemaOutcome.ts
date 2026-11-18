import { Err } from "@bluestep-systems/b6p-core";
import type {
  SchemaActionKind,
  SchemaApplyRefusal,
  SchemaApplyResult,
  SchemaDelta,
  SchemaPlannedAction,
  SchemaRecipeFinding,
  SchemaRecipeResult,
  SchemaRefusal,
  SchemaRefusalCode,
  SchemaTestResult,
} from "@bluestep-systems/b6p-core";
import { shellQuote, type ShellDialect } from "./pushOutcome";

/**
 * What `b6p schema` tells a caller whose account may not run the schema commands: they are reserved to super users.
 * @lastreviewed null
 */
export const SUPER_ONLY_LINE = "The schema commands are reserved to super users, and this account is not one.";

/**
 * The process exit code of a schema command that declined at its confirmation prompt: nothing was applied, and the
 * caller said no (a refusal or a failure is `1`).
 * @lastreviewed null
 */
export const EXIT_DECLINED = 2;

/**
 * Why a schema command is reported as not having gone through, as a machine-readable tag in `--json`'s
 * `error.kind`. Stable: a consumer branches on it.
 * @lastreviewed null
 */
export type SchemaErrorKind =
  /** The gate did not pass: the manifest was refused, or a plan element is a CONFLICT. @lastreviewed null */
  | "GATE_FAILED"
  /** The test was refused before the manifest was read (the schema history is unavailable). @lastreviewed null */
  | "TEST_REFUSED"
  /** The gate passed and the caller said yes, but the server did not apply the plan. @lastreviewed null */
  | "NOT_APPLIED"
  /** The gate passed and the caller answered no at the prompt. @lastreviewed null */
  | "DECLINED"
  /** The account is not a super user. @lastreviewed null */
  | "SUPER_ONLY"
  /** The org's server predates the schema apply feature, or an argument of it. @lastreviewed null */
  | "SERVER_TOO_OLD"
  /** `--u` named an org the U cache and BlueHQ do not know. @lastreviewed null */
  | "ORG_UNKNOWN"
  /** `--u` could not be looked up (BlueHQ or the network failed): not the same as unknown. @lastreviewed null */
  | "ORG_LOOKUP_FAILED"
  /** The recipe name is not one this version knows. @lastreviewed null */
  | "UNKNOWN_RECIPE"
  /** The manifest file could not be read. @lastreviewed null */
  | "MANIFEST_UNREADABLE"
  /** `-o` named a file that exists, and its overwrite was not confirmed. @lastreviewed null */
  | "OUTPUT_EXISTS"
  /** The apply was sent and the connection failed before its answer: the manifest may or may not have been applied. @lastreviewed null */
  | "APPLY_OUTCOME_UNKNOWN";

/**
 * `--json`'s `error` of a schema command: why it is reported as failed (`kind`), what happened (`message`) and what
 * to do (`howTo`), the same words printed on stderr.
 * @lastreviewed null
 */
export interface SchemaErrorJson {
  /** The tag a consumer branches on. @lastreviewed null */
  kind: SchemaErrorKind;
  /** What happened, in one sentence. @lastreviewed null */
  message: string;
  /** What to do next (may name `b6p` commands), or `null` when there is nothing to do. @lastreviewed null */
  howTo: string | null;
}

/**
 * A {@link SchemaTestResult} as `--json` shows it: without `schemaMutationKey`, the one-use key that authorizes an
 * apply. `apply` mints its own, so nothing a caller reads needs it.
 * @lastreviewed null
 */
export type SchemaTestView = Omit<SchemaTestResult, "schemaMutationKey">;

/**
 * What `b6p schema test --json` prints: core's {@link SchemaTestResult} without its key, and the CLI's verdict. One
 * shape for every outcome, failures that never reached the server included.
 * @lastreviewed null
 */
export type SchemaTestJson = SchemaTestView & {
  /** Why the test is reported as failed (and exits `1`), `null` when the gate passed. @lastreviewed null */
  error: SchemaErrorJson | null;
};

/**
 * What `b6p schema apply --json` prints: the dry run, whether the caller declined, the apply's answer, and the
 * CLI's verdict. One shape for every outcome.
 * @lastreviewed null
 */
export interface SchemaApplyJson {
  /** The dry run the apply followed, without its key; an empty one when the apply failed before it. @lastreviewed null */
  test: SchemaTestView;
  /** The caller was shown a passing plan and answered no, so nothing was applied. @lastreviewed null */
  declined: boolean;
  /** The server's answer to the apply; `null` when the gate did not pass or the caller declined. @lastreviewed null */
  apply: SchemaApplyResult | null;
  /** Why the apply is reported as failed or declined (exit `1` or `2`), `null` when it was applied. @lastreviewed null */
  error: SchemaErrorJson | null;
}

/**
 * What `b6p schema recipe --json` prints: core's {@link SchemaRecipeResult} (manifest and findings in one body) and
 * the file the manifest was also written to, if any.
 * @lastreviewed null
 */
export type SchemaRecipeJson = Omit<SchemaRecipeResult, "manifest"> & {
  /** The recipe's manifest; `null` when the command failed. @lastreviewed null */
  manifest: string | null;
  /** The `-o` file the manifest was written to, or `null` when it was not. @lastreviewed null */
  file: string | null;
  /** Why the command failed, `null` when it did not. @lastreviewed null */
  error: SchemaErrorJson | null;
};

/**
 * What `b6p schema generate --json` prints: the manifest, and the `-o` file it was also written to, if any.
 * @lastreviewed null
 */
export interface SchemaGenerateJson {
  /** The manifest, a YAML stream; `null` when the command failed. @lastreviewed null */
  manifest: string | null;
  /** The `-o` file the manifest was written to, or `null` when it was not. @lastreviewed null */
  file: string | null;
  /** Why the command failed, `null` when it did not. @lastreviewed null */
  error: SchemaErrorJson | null;
}

/**
 * What the printed "how to go on" commands need: the file the user named and the shell the printed commands are written for.
 * @lastreviewed null
 */
export interface SchemaCommandContext {
  /** The manifest file, as the user gave it. @lastreviewed null */
  file: string;
  /** The shell the "how to go on" commands are quoted for. @lastreviewed null */
  dialect: ShellDialect;
  /** The org, as the user named it; repeated in the commands printed. @lastreviewed null */
  selector: OrgSelector;
  /** The user ran `apply` with `--confirm`; repeated in the apply command printed. @lastreviewed null */
  confirm: boolean;
}

/**
 * Which org a schema command acts on, as the user named it: `--org <url>` (any URL on the org) or `--u <Uxxxxxx>`.
 * @lastreviewed null
 */
export type OrgSelector = { flag: "--org"; value: string } | { flag: "--u"; value: string };

/**
 * Reads the org out of a schema command's options: exactly one of `--org` and `--u`. `--u` is normalised to upper
 * case and must be a U and six digits.
 * @param opts The command's `--org` and `--u` values, when given
 * @returns The selector, or the usage error to print
 * @lastreviewed null
 */
export function selectOrg(opts: { org?: string; u?: string }): { selector: OrgSelector } | { usageError: string } {
  if (opts.org !== undefined && opts.u !== undefined) {
    return { usageError: "Give either --org <url> or --u <Uxxxxxx>, not both." };
  }
  if (opts.org !== undefined) {
    return { selector: { flag: "--org", value: opts.org } };
  }
  if (opts.u !== undefined) {
    const u = opts.u.toUpperCase();
    return /^U\d{6}$/.test(u)
      ? { selector: { flag: "--u", value: u } }
      : { usageError: `--u takes a U and six digits (U123456), not "${opts.u}".` };
  }
  return { usageError: "Name the org with --org <url> or --u <Uxxxxxx>." };
}

/**
 * The line for a `--u` the org cache cannot turn into a URL.
 * @lastreviewed null
 */
export function unknownULine(u: string): string {
  return `No org URL is known for ${u}. Pass --org <url> instead.`;
}

/**
 * The actions of a plan in the order the plan summary lists them.
 * @lastreviewed null
 */
const ACTION_ORDER: readonly SchemaActionKind[] = ["CREATE", "ADOPT", "UPDATE", "CONFLICT", "NO_CHANGE"];

/**
 * The `b6p` command that runs a manifest's test again.
 * @lastreviewed null
 */
function testCommand(ctx: SchemaCommandContext): string {
  return `b6p schema test ${shellQuote(ctx.file, ctx.dialect)} ${ctx.selector.flag} ${shellQuote(ctx.selector.value, ctx.dialect)}`;
}

/**
 * The `b6p` command that tests and applies a manifest again.
 * @lastreviewed null
 */
function applyCommand(ctx: SchemaCommandContext): string {
  const confirm = ctx.confirm ? " --confirm" : "";
  return `b6p schema apply ${shellQuote(ctx.file, ctx.dialect)} ${ctx.selector.flag} ${shellQuote(ctx.selector.value, ctx.dialect)}${confirm}`;
}

/**
 * One line for a manifest-level refusal: stage, code, where, and why.
 * @lastreviewed null
 */
export function describeRefusal(refusal: SchemaRefusal): string {
  const hits = refusal.hits.length > 0 ? ` (${refusal.hits.length} objects matched)` : "";
  return `${refusal.stage} ${refusal.code} at ${refusal.locus}: ${refusal.detail}${hits}`;
}

/**
 * One line for a refusal of an apply, or of a test before the manifest was read: the code, the element when one is to
 * blame, and why.
 * @lastreviewed null
 */
export function describeApplyRefusal(refusal: SchemaApplyRefusal): string {
  return refusal.element === null
    ? `${refusal.code}: ${refusal.detail}`
    : `${refusal.code} at ${refusal.element}: ${refusal.detail}`;
}

/**
 * One line for a delta of an update: a property's change (`from → to`, `(none)` for a value that is absent) or a
 * container's reorder.
 * @lastreviewed null
 */
export function describeDelta(delta: SchemaDelta): string {
  if (delta.kind === "REORDER") {
    return `${delta.path}: reorder (live positions ${delta.livePositions.join(", ")})`;
  }
  return `${delta.path}: ${delta.from ?? "(none)"} → ${delta.to ?? "(none)"}`;
}

/**
 * The lines for one non-NO_CHANGE action: the action and its element, then its deltas or reasons, indented.
 * @lastreviewed null
 */
function describeAction(action: SchemaPlannedAction): string[] {
  const lines = [`${action.action} ${action.element}`];
  for (const delta of action.deltas) {
    lines.push(`    ${describeDelta(delta)}`);
  }
  for (const reason of action.reasons) {
    lines.push(`    ${reason.code}: ${reason.detail}`);
  }
  return lines;
}

/**
 * The plan of a test result, compact: a count per action, then each action that is not NO_CHANGE with its deltas or
 * reasons, then the warnings. Never includes the key.
 * @param result What `core.schema.test()` answered
 * @returns The lines to print; empty when the manifest was refused before a plan was made and there is nothing to
 *   say about a plan
 * @lastreviewed null
 */
export function describePlan(result: SchemaTestResult): string[] {
  const lines: string[] = [];
  if (result.actions.length > 0) {
    const counts = ACTION_ORDER.map((kind) => [kind, result.actions.filter((a) => a.action === kind).length] as const)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${count} ${kind}`);
    lines.push(`Plan: ${counts.join(", ")}`);
    for (const action of result.actions) {
      if (action.action !== "NO_CHANGE") {
        lines.push(...describeAction(action));
      }
    }
  }
  if (result.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of result.warnings) {
      lines.push(`  ${warning.element}: ${warning.detail}`);
    }
  }
  return lines;
}

/**
 * Whether a plan holds nothing to apply: every action is NO_CHANGE.
 * @lastreviewed null
 */
export function isNoChangeOnly(result: SchemaTestResult): boolean {
  return result.actions.every((a) => a.action === "NO_CHANGE");
}

/**
 * The gate verdict as lines: `passed` (with a note when there is nothing to change), or where it failed and every
 * refusal. Pairs with {@link describePlan}.
 * @lastreviewed null
 */
export function describeVerdict(result: SchemaTestResult): string[] {
  if (result.passed) {
    return [isNoChangeOnly(result) ? "Gate passed: nothing to change." : "Gate passed."];
  }
  const lines = [`Gate failed${result.failedAt === null ? "" : ` at ${result.failedAt}`}.`];
  if (result.refusal !== null) {
    lines.push(`  ${describeApplyRefusal(result.refusal)}`);
  }
  for (const refusal of result.refusals) {
    lines.push(`  ${describeRefusal(refusal)}`);
  }
  return lines;
}

/**
 * The error a test reports, or `null` when the gate passed.
 * @param result What `core.schema.test()` answered
 * @returns The verdict, the same words printed on stderr
 * @lastreviewed null
 */
export function testProblem(result: SchemaTestResult): SchemaErrorJson | null {
  if (result.passed) {
    return null;
  }
  if (result.refusal !== null) {
    return { kind: "TEST_REFUSED", message: describeApplyRefusal(result.refusal), howTo: null };
  }
  const where = result.failedAt === null ? "" : ` at ${result.failedAt}`;
  return {
    kind: "GATE_FAILED",
    message: `The manifest did not pass the gate${where}; nothing can be applied.`,
    howTo: null,
  };
}

/**
 * What a refusal code asks of the caller, for the codes that have a standing answer.
 * @lastreviewed null
 */
function howToGo(code: SchemaRefusalCode, again: string): string | null {
  switch (code) {
    case "STALE":
      return `The org changed since the test, so the plan no longer holds. Re-run: ${again}`;
    case "KEY_INVALID":
      return `The key from the test expired (ten minutes) or was already used. Re-run: ${again}`;
    default:
      return null;
  }
}

/**
 * The error an apply reports, or `null` when it was applied.
 * @param test The dry run
 * @param declined The caller answered no
 * @param apply The server's answer, or `null` when it was not asked
 * @param ctx The file and shell for the "how to go on" lines
 * @lastreviewed null
 */
export function applyProblem(
  test: SchemaTestResult,
  declined: boolean,
  apply: SchemaApplyResult | null,
  ctx: SchemaCommandContext
): SchemaErrorJson | null {
  if (!test.passed) {
    return testProblem(test);
  }
  if (declined) {
    return { kind: "DECLINED", message: "Not applied: the plan was declined.", howTo: null };
  }
  if (apply === null && isNoChangeOnly(test)) {
    return null;
  }
  if (apply === null) {
    return { kind: "NOT_APPLIED", message: "The apply was not made.", howTo: null };
  }
  if (apply.applied) {
    return null;
  }
  const refusal = apply.refusal;
  const message =
    refusal === null
      ? `The plan no longer passes the gate${apply.failedAt === null ? "" : ` at ${apply.failedAt}`}; nothing was written.`
      : describeApplyRefusal(refusal);
  const standing = refusal === null ? null : howToGo(refusal.code, applyCommand(ctx));
  return { kind: "NOT_APPLIED", message, howTo: standing ?? `Check the plan with: ${testCommand(ctx)}` };
}

/**
 * The exit code of `b6p schema test`: `0` when the gate passed (a plan that is NO_CHANGE throughout included), `1`
 * otherwise.
 * @lastreviewed null
 */
export function testExitCode(result: SchemaTestResult): number {
  return result.passed ? 0 : 1;
}

/**
 * The exit code of `b6p schema apply`: `0` when applied, or when the gate passed and the plan changes nothing (the
 * caller is not asked and `apply` is `null`); `2`
 * when the caller declined the prompt; `1` for everything else.
 * @lastreviewed null
 */
export function applyExitCode(test: SchemaTestResult, declined: boolean, apply: SchemaApplyResult | null): number {
  if (!test.passed) {
    return 1;
  }
  if (declined) {
    return EXIT_DECLINED;
  }
  if (apply === null) {
    return isNoChangeOnly(test) ? 0 : 1;
  }
  return apply.applied ? 0 : 1;
}

/**
 * The lines an apply that went through prints: each applied object, then the history commit.
 * @lastreviewed null
 */
export function describeApplied(apply: SchemaApplyResult): string[] {
  const lines = [`Applied ${apply.objects.length} ${apply.objects.length === 1 ? "object" : "objects"}.`];
  for (const object of apply.objects) {
    lines.push(`  ${object.element}  ${object.objectId}`);
  }
  if (apply.historyCommit !== null) {
    lines.push(`History commit: ${apply.historyCommit}`);
  }
  return lines;
}

/**
 * The lines for a recipe's findings, one per finding: severity, code, what it concerns, and the detail.
 * @lastreviewed null
 */
export function describeFindings(findings: readonly SchemaRecipeFinding[]): string[] {
  return findings.map((f) => {
    const concerns = [f.formId, f.fieldId, f.subjectId].filter((c): c is string => c !== null);
    return `${f.severity} ${f.code}${concerns.length > 0 ? ` (${concerns.join(", ")})` : ""}: ${f.detail}`;
  });
}

/**
 * The body of `b6p schema test --json`.
 * @lastreviewed null
 */
export function toTestJson(result: SchemaTestResult): SchemaTestJson {
  return { ...withoutKey(result), error: testProblem(result) };
}

/**
 * A test result without its one-use mutation key, for anything that is printed as `--json`.
 * @lastreviewed null
 */
export function withoutKey(result: SchemaTestResult): SchemaTestView {
  const { schemaMutationKey: _key, ...rest } = result;
  return rest;
}

/**
 * The test result of a command that failed before a test was made: the gate did not pass, and there is no plan.
 * @lastreviewed null
 */
const NO_TEST: SchemaTestView = {
  passed: false,
  failedAt: null,
  actions: [],
  refusals: [],
  refusal: null,
  warnings: [],
};

/**
 * The command families that have a `--json` body of their own.
 * @lastreviewed null
 */
export type SchemaCommandFamily = "generate" | "recipe" | "test" | "apply";

/**
 * The `--json` body of a command that failed before it had a result (not a super user, an org that cannot be
 * resolved, a manifest that cannot be read, ...): the family's own shape, empty, with `error` set, so a consumer
 * parses one schema whatever happened.
 * @param family Which command failed
 * @param error What to tell the caller
 * @param shown For `apply`, the plan the caller was shown before the failure, if there was one (its key is dropped)
 * @lastreviewed null
 */
export function toFailureJson(
  family: SchemaCommandFamily,
  error: SchemaErrorJson,
  shown?: SchemaTestResult
): SchemaGenerateJson | SchemaRecipeJson | SchemaTestJson | SchemaApplyJson {
  switch (family) {
    case "generate":
      return { manifest: null, file: null, error };
    case "recipe":
      return { manifest: null, findings: [], file: null, error };
    case "test":
      return { ...NO_TEST, error };
    case "apply":
      return { test: shown === undefined ? NO_TEST : withoutKey(shown), declined: false, apply: null, error };
  }
}

/**
 * The body of `b6p schema apply --json`.
 * @lastreviewed null
 */
export function toApplyJson(
  test: SchemaTestResult,
  declined: boolean,
  apply: SchemaApplyResult | null,
  ctx: SchemaCommandContext
): SchemaApplyJson {
  return { test: withoutKey(test), declined, apply, error: applyProblem(test, declined, apply, ctx) };
}

/**
 * Whether a thrown error is core saying the server refused a schema operation as `FORBIDDEN`: this account is not a
 * super user.
 * @param err What was thrown
 * @lastreviewed null
 */
export function isForbidden(err: unknown): boolean {
  return err instanceof Err.SchemaForbiddenError;
}

/**
 * What `apply` reports when the call to the server ended in an error after the caller said yes: the request may have
 * reached the server, and the one-use key is spent either way, so whether the plan was applied is not known.
 * @param err What was thrown
 * @param ctx The file and shell for the command printed
 * @lastreviewed null
 */
export function applyOutcomeUnknown(err: unknown, ctx: SchemaCommandContext): SchemaErrorJson {
  const why = err instanceof Error ? err.message : String(err);
  return {
    kind: "APPLY_OUTCOME_UNKNOWN",
    message: `The apply was sent but its answer did not come back (${why}), so it may or may not have been applied.`,
    howTo: `Find out with: ${testCommand(ctx)}  (a plan that now changes nothing was applied)`,
  };
}

/**
 * The statuses BlueHQ answers for a U it does not know: 404, and 406 (seen for a tenant that exists only locally).
 * Core's error carries the status in its message ("...from BlueHQ: 406"), so it is read from there.
 * @lastreviewed null
 */
const UNKNOWN_U_STATUS = /: (?:404|406)\b/;

/**
 * What a failed `--u` lookup reports. Only a BlueHQ answer of "not found" (404 or 406) says the U is unknown; any other failure
 * (the network, a server error) is a failed lookup and says so, rather than blaming the U.
 * @param u The U that was looked up
 * @param err What core threw
 * @lastreviewed null
 */
export function orgLookupProblem(u: string, err: unknown): SchemaErrorJson {
  if (err instanceof Err.BlueHqHelperEndpointError && UNKNOWN_U_STATUS.test(err.message)) {
    return { kind: "ORG_UNKNOWN", message: unknownULine(u), howTo: null };
  }
  const why = err instanceof Error ? err.message : String(err);
  return {
    kind: "ORG_LOOKUP_FAILED",
    message: `Could not look up the org for ${u}: ${why}`,
    howTo: "Try again, or pass --org <url> instead.",
  };
}

/**
 * Whether a thrown error is core saying the org's server predates the schema apply feature (or an argument of it).
 * @lastreviewed null
 */
export function isServerTooOld(err: unknown): err is Err.SchemaServerTooOldError {
  return err instanceof Err.SchemaServerTooOldError;
}

/**
 * What a server that predates the schema apply feature is told: the feature it lacks, and for the display-name
 * warning, that the command works without it.
 * @param err The error core threw
 * @lastreviewed null
 */
export function serverTooOldProblem(err: Err.SchemaServerTooOldError): SchemaErrorJson {
  return {
    kind: "SERVER_TOO_OLD",
    message: `This org's server does not support ${err.feature}; it predates the schema apply feature.`,
    howTo: err.feature.includes("verbose") ? "Run it again without --warn-names." : null,
  };
}

/**
 * The line for a recipe name this version does not know.
 * @lastreviewed null
 */
export function unknownRecipeProblem(name: string, known: readonly string[]): SchemaErrorJson {
  return {
    kind: "UNKNOWN_RECIPE",
    message: `${name} is not a recipe this version knows. Use one of: ${known.join(", ")}.`,
    howTo: null,
  };
}

/**
 * The error for a manifest file that cannot be read.
 * @lastreviewed null
 */
export function manifestUnreadableProblem(file: string, err: unknown): SchemaErrorJson {
  return {
    kind: "MANIFEST_UNREADABLE",
    message: `Cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`,
    howTo: null,
  };
}

/**
 * The error for an `-o` file that exists and was not overwritten.
 * @lastreviewed null
 */
export function outputExistsProblem(file: string): SchemaErrorJson {
  return {
    kind: "OUTPUT_EXISTS",
    message: `${file} already exists and was not overwritten.`,
    howTo: "Pick another -o file, or run again without --yes and answer Overwrite.",
  };
}

/**
 * The exit code once a command has said what it wants: never lower than one an earlier failure already set, so a
 * success path cannot hide a reported failure.
 * @param current `process.exitCode` now
 * @param wanted The code this command's outcome calls for
 * @lastreviewed null
 */
export function raiseExitCode(current: typeof process.exitCode, wanted: number): number {
  const now = Number(current ?? 0);
  return Number.isNaN(now) ? wanted : Math.max(now, wanted);
}

/**
 * `text` ending in exactly one newline, for printing a manifest.
 * @lastreviewed null
 */
export function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
