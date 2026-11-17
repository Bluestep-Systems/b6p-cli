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
 * Why a `test` or `apply` is reported as not having gone through, as a machine-readable tag in `--json`'s
 * `error.kind`. Stable: a consumer branches on it.
 * @lastreviewed null
 */
export type SchemaErrorKind =
  /** The gate did not pass: the manifest was refused, or a plan element is a CONFLICT. */
  | "GATE_FAILED"
  /** The test was refused before the manifest was read (the schema history is unavailable). */
  | "TEST_REFUSED"
  /** The gate passed and the caller said yes, but the server did not apply the plan. */
  | "NOT_APPLIED"
  /** The gate passed and the caller answered no at the prompt. */
  | "DECLINED"
  /** The account is not a super user. */
  | "SUPER_ONLY";

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
 * What `b6p schema test --json` prints: core's {@link SchemaTestResult} (the `schemaMutationKey` included; human
 * output never prints it) and the CLI's verdict. One shape for every outcome.
 * @lastreviewed null
 */
export type SchemaTestJson = SchemaTestResult & {
  /** Why the test is reported as failed (and exits `1`), `null` when the gate passed. @lastreviewed null */
  error: SchemaErrorJson | null;
};

/**
 * What `b6p schema apply --json` prints: the dry run, whether the caller declined, the apply's answer, and the
 * CLI's verdict. One shape for every outcome.
 * @lastreviewed null
 */
export interface SchemaApplyJson {
  /** The dry run the apply followed (its key included). @lastreviewed null */
  test: SchemaTestResult;
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
export type SchemaRecipeJson = SchemaRecipeResult & {
  /** The `-o` file the manifest was written to, or `null` when it was not. @lastreviewed null */
  file: string | null;
};

/**
 * What `b6p schema generate --json` prints: the manifest, and the `-o` file it was also written to, if any.
 * @lastreviewed null
 */
export interface SchemaGenerateJson {
  /** The manifest, a YAML stream. @lastreviewed null */
  manifest: string;
  /** The `-o` file the manifest was written to, or `null` when it was not. @lastreviewed null */
  file: string | null;
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
function testCommand(ctx: SchemaCommandContext, org: string): string {
  return `b6p schema test ${shellQuote(ctx.file, ctx.dialect)} --org ${shellQuote(org, ctx.dialect)}`;
}

/**
 * The `b6p` command that tests and applies a manifest again.
 * @lastreviewed null
 */
function applyCommand(ctx: SchemaCommandContext, org: string): string {
  return `b6p schema apply ${shellQuote(ctx.file, ctx.dialect)} --org ${shellQuote(org, ctx.dialect)}`;
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
 * @param org The org the apply ran against, repeated in the commands printed
 * @lastreviewed null
 */
export function applyProblem(
  test: SchemaTestResult,
  declined: boolean,
  apply: SchemaApplyResult | null,
  ctx: SchemaCommandContext,
  org: string
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
  return {
    kind: "NOT_APPLIED",
    message,
    howTo: howToGo(refusal?.code ?? "STALE", applyCommand(ctx, org)) ?? `Check the plan with: ${testCommand(ctx, org)}`,
  };
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
  return { ...result, error: testProblem(result) };
}

/**
 * The body of `b6p schema apply --json`.
 * @lastreviewed null
 */
export function toApplyJson(
  test: SchemaTestResult,
  declined: boolean,
  apply: SchemaApplyResult | null,
  ctx: SchemaCommandContext,
  org: string
): SchemaApplyJson {
  return { test, declined, apply, error: applyProblem(test, declined, apply, ctx, org) };
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
