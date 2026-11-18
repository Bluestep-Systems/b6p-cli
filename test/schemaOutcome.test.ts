// Unit spec for the pure outcome functions behind `b6p schema`: exit codes, `--json` shapes, plan rendering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Err } from "@bluestep-systems/b6p-core";
import type { SchemaApplyResult, SchemaPlannedAction, SchemaTestResult } from "@bluestep-systems/b6p-core";
import {
  type SchemaCommandContext,
  applyOutcomeUnknown,
  manifestUnreadableProblem,
  orgLookupProblem,
  outputExistsProblem,
  raiseExitCode,
  serverTooOldProblem,
  toFailureJson,
  unknownRecipeProblem,
  withTrailingNewline,
  withoutKey,
  selectOrg,
  unknownULine,
  EXIT_DECLINED,
  applyExitCode,
  applyProblem,
  describeApplied,
  describeFindings,
  describePlan,
  describeVerdict,
  isForbidden,
  testExitCode,
  toApplyJson,
  toTestJson,
} from "../src/schemaOutcome";

const ctx: SchemaCommandContext = {
  file: "my manifest.yaml",
  dialect: "posix",
  selector: { flag: "--org", value: "https://org.example.com" },
  confirm: false,
};

function action(over: Partial<SchemaPlannedAction>): SchemaPlannedAction {
  return { element: "Form a", action: "NO_CHANGE", objectId: null, spec: null, deltas: [], reasons: [], ...over };
}

function passed(actions: SchemaPlannedAction[]): SchemaTestResult {
  return {
    passed: true,
    failedAt: null,
    actions,
    refusals: [],
    schemaMutationKey: "KEY-1",
    refusal: null,
    warnings: [],
  };
}

function refused(): SchemaTestResult {
  return {
    passed: false,
    failedAt: "RESOLUTION",
    actions: [],
    refusals: [
      {
        stage: "RESOLUTION",
        code: "UNRESOLVED_REFERENCE",
        locus: "document 2",
        detail: "no such form",
        hits: [],
      },
    ],
    schemaMutationKey: null,
    refusal: null,
    warnings: [],
  };
}

function applied(): SchemaApplyResult {
  return {
    applied: true,
    objects: [{ element: "Form a", objectId: "123" }],
    refusal: null,
    failedAt: null,
    historyCommit: "abc1234",
  };
}

function notApplied(code: "STALE" | "KEY_INVALID" | "NAME_TAKEN"): SchemaApplyResult {
  return {
    applied: false,
    objects: [],
    refusal: { code, element: null, detail: "why" },
    failedAt: null,
    historyCommit: null,
  };
}

test("test exits 0 when the gate passed, a NO_CHANGE-only plan included, and 1 when it did not", () => {
  assert.equal(testExitCode(passed([action({})])), 0);
  assert.equal(testExitCode(passed([action({ action: "CREATE" })])), 0);
  assert.equal(testExitCode(refused()), 1);
});

test("apply exits 0 applied, 2 declined, 1 otherwise", () => {
  const plan = passed([action({ action: "UPDATE" })]);
  assert.equal(applyExitCode(plan, false, applied()), 0);
  assert.equal(applyExitCode(plan, true, null), EXIT_DECLINED);
  assert.equal(EXIT_DECLINED, 2);
  assert.equal(applyExitCode(plan, false, notApplied("STALE")), 1);
  assert.equal(applyExitCode(refused(), false, null), 1);
});

test("a passing plan that changes nothing is not asked about, and is not a failure or a decline", () => {
  const plan = passed([action({})]);
  assert.equal(applyExitCode(plan, false, null), 0);
  assert.equal(applyProblem(plan, false, null, ctx), null);
});

test("a plan that did not pass is a failure even if the caller somehow declined", () => {
  assert.equal(applyExitCode(refused(), true, null), 1);
  assert.equal(applyProblem(refused(), true, null, ctx)?.kind, "GATE_FAILED");
});

test("STALE and KEY_INVALID say to re-run, with the manifest and org quoted for the shell", () => {
  for (const code of ["STALE", "KEY_INVALID"] as const) {
    const problem = applyProblem(passed([action({ action: "UPDATE" })]), false, notApplied(code), ctx);
    assert.equal(problem?.kind, "NOT_APPLIED");
    assert.match(problem?.message ?? "", new RegExp(code));
    assert.match(problem?.howTo ?? "", /Re-run: b6p schema apply 'my manifest\.yaml' --org https:\/\/org\.example\.com/);
  }
});

test("the re-run command repeats --u and --confirm as the user gave them", () => {
  const again = { ...ctx, selector: { flag: "--u", value: "U123456" }, confirm: true } as const;
  const problem = applyProblem(passed([action({ action: "UPDATE" })]), false, notApplied("STALE"), again);
  assert.match(problem?.howTo ?? "", /Re-run: b6p schema apply 'my manifest\.yaml' --u U123456 --confirm$/);
});

test("exactly one of --org and --u names the org", () => {
  assert.deepEqual(selectOrg({ org: "https://o.example.com" }), { selector: { flag: "--org", value: "https://o.example.com" } });
  assert.deepEqual(selectOrg({ u: "u123456" }), { selector: { flag: "--u", value: "U123456" } });
  assert.match((selectOrg({ org: "https://o.example.com", u: "U123456" }) as { usageError: string }).usageError, /not both/);
  assert.match((selectOrg({}) as { usageError: string }).usageError, /--org <url> or --u/);
  assert.match((selectOrg({ u: "123" }) as { usageError: string }).usageError, /U and six digits/);
});

test("an unknown U says to pass --org instead", () => {
  assert.equal(unknownULine("U123456"), "No org URL is known for U123456. Pass --org <url> instead.");
});

test("another refusal points at test rather than re-running", () => {
  const problem = applyProblem(passed([action({ action: "CREATE" })]), false, notApplied("NAME_TAKEN"), ctx);
  assert.match(problem?.howTo ?? "", /^Check the plan with: b6p schema test /);
});

test("an applied plan has no error", () => {
  assert.equal(applyProblem(passed([action({ action: "CREATE" })]), false, applied(), ctx), null);
});

test("a gate that no longer passes at apply time names the stage", () => {
  const apply: SchemaApplyResult = { applied: false, objects: [], refusal: null, failedAt: "POLICY", historyCommit: null };
  const problem = applyProblem(passed([action({ action: "CREATE" })]), false, apply, ctx);
  assert.match(problem?.message ?? "", /POLICY/);
});

test("--json carries one error field for test and apply", () => {
  const plan = passed([action({ action: "CREATE" })]);
  assert.equal(toTestJson(plan).error, null);
  assert.equal(toTestJson(refused()).error?.kind, "GATE_FAILED");
  const json = toApplyJson(plan, false, applied(), ctx);
  assert.equal(json.error, null);
  assert.equal(toApplyJson(plan, true, null, ctx).error?.kind, "DECLINED");
});

test("the plan is counts, then each action that changes something, and never the key", () => {
  const plan = passed([
    action({ element: "Form a", action: "NO_CHANGE" }),
    action({ element: "Form b", action: "NO_CHANGE" }),
    action({ element: "Form c", action: "CREATE" }),
    action({
      element: "Form d",
      action: "UPDATE",
      deltas: [
        { path: "label", kind: "CHANGE", from: '"a"', to: '"b"', livePositions: [] },
        { path: "fields", kind: "REORDER", from: null, to: null, livePositions: [2, 0, 1] },
        { path: "note", kind: "CHANGE", from: null, to: '"n"', livePositions: [] },
      ],
    }),
  ]);
  plan.warnings = [{ element: "Form c", detail: "careful" }];
  const text = describePlan(plan).join("\n");
  assert.equal(
    text,
    [
      "Plan: 1 CREATE, 1 UPDATE, 2 NO_CHANGE",
      "CREATE Form c",
      "UPDATE Form d",
      '    label: "a" → "b"',
      "    fields: reorder (live positions 2, 0, 1)",
      '    note: (none) → "n"',
      "Warnings:",
      "  Form c: careful",
    ].join("\n")
  );
  assert.ok(!text.includes("KEY-1"));
  assert.ok(!describeVerdict(plan).join("\n").includes("KEY-1"));
});

test("a conflict lists its reasons", () => {
  const plan = passed([
    action({ element: "Form x", action: "CONFLICT", reasons: [{ code: "NAME_TAKEN", detail: "taken" }] }),
  ]);
  assert.deepEqual(describePlan(plan), ["Plan: 1 CONFLICT", "CONFLICT Form x", "    NAME_TAKEN: taken"]);
});

test("the verdict says passed, nothing to change, or where the gate failed and why", () => {
  assert.deepEqual(describeVerdict(passed([action({ action: "CREATE" })])), ["Gate passed."]);
  assert.deepEqual(describeVerdict(passed([action({})])), ["Gate passed: nothing to change."]);
  assert.deepEqual(describeVerdict(refused()), [
    "Gate failed at RESOLUTION.",
    "  RESOLUTION UNRESOLVED_REFERENCE at document 2: no such form",
  ]);
  const early: SchemaTestResult = {
    ...refused(),
    failedAt: null,
    refusals: [],
    refusal: { code: "HISTORY_UNAVAILABLE", element: null, detail: "no history" },
  };
  assert.deepEqual(describeVerdict(early), ["Gate failed.", "  HISTORY_UNAVAILABLE: no history"]);
  assert.equal(toTestJson(early).error?.kind, "TEST_REFUSED");
});

test("an applied result lists its objects and the history commit", () => {
  assert.deepEqual(describeApplied(applied()), ["Applied 1 object.", "  Form a  123", "History commit: abc1234"]);
});

test("recipe findings print severity, code, what they concern and the detail", () => {
  assert.deepEqual(
    describeFindings([
      { code: "UNNAMED_FORM", severity: "ERROR", subjectId: null, fieldId: "f1", formId: "F1", detail: "no name" },
      { code: "GENERATOR_NOTE", severity: "WARNING", subjectId: null, fieldId: null, formId: null, detail: "note" },
    ]),
    ["ERROR UNNAMED_FORM (F1, f1): no name", "WARNING GENERATOR_NOTE: note"]
  );
});

test("core's SchemaForbiddenError is the super-only refusal; other errors are not", () => {
  assert.equal(isForbidden(new Err.SchemaForbiddenError("testSchema")), true);
  assert.equal(isForbidden(new Error("FORBIDDEN")), false);
  assert.equal(isForbidden(new Err.SchemaServerTooOldError("testSchema(verbose:)", "unknown argument")), false);
  assert.equal(isForbidden("FORBIDDEN"), false);
});

test("F5: a refusal-less failed apply points at test, never at a STALE re-run", () => {
  const apply: SchemaApplyResult = { applied: false, objects: [], refusal: null, failedAt: "POLICY", historyCommit: null };
  const problem = applyProblem(passed([action({ action: "CREATE" })]), false, apply, ctx);
  assert.match(problem?.howTo ?? "", /^Check the plan with: b6p schema test /);
  assert.ok(!/Re-run/.test(problem?.howTo ?? ""));
});

test("F6: --json never carries the one-use mutation key", () => {
  const plan = passed([action({ action: "CREATE" })]);
  assert.ok(!("schemaMutationKey" in toTestJson(plan)));
  assert.ok(!("schemaMutationKey" in toApplyJson(plan, false, applied(), ctx).test));
  assert.ok(!JSON.stringify(toApplyJson(plan, false, applied(), ctx)).includes("KEY-1"));
  assert.ok(!("schemaMutationKey" in withoutKey(plan)));
});

test("F3: a failure that never reached a result has its family's body with error set", () => {
  const error = { kind: "SUPER_ONLY", message: "m", howTo: null } as const;
  assert.deepEqual(toFailureJson("generate", error), { manifest: null, file: null, error });
  assert.deepEqual(toFailureJson("recipe", error), { manifest: null, findings: [], file: null, error });
  const test = toFailureJson("test", error) as ReturnType<typeof toTestJson>;
  assert.equal(test.passed, false);
  assert.deepEqual(test.actions, []);
  assert.equal(test.error, error);
  const apply = toFailureJson("apply", error) as ReturnType<typeof toApplyJson>;
  assert.equal(apply.apply, null);
  assert.equal(apply.declined, false);
  assert.equal(apply.test.passed, false);
  assert.equal(apply.error, error);
});

test("F2: an error after the yes says the outcome is unknown and how to find out", () => {
  const problem = applyOutcomeUnknown(new Error("socket hang up"), ctx);
  assert.equal(problem.kind, "APPLY_OUTCOME_UNKNOWN");
  assert.match(problem.message, /socket hang up.*may or may not have been applied/);
  assert.match(problem.howTo ?? "", /b6p schema test 'my manifest\.yaml' --org https:\/\/org\.example\.com/);
});

test("F4: only a BlueHQ not-found says the U is unknown; any other failure is a failed lookup", () => {
  const notFound = new Err.BlueHqHelperEndpointError("Failed to fetch any domain from BlueHQ: 404 Not Found");
  assert.equal(orgLookupProblem("U123456", notFound).kind, "ORG_UNKNOWN");
  const serverError = new Err.BlueHqHelperEndpointError("Failed to fetch any domain from BlueHQ: 503 Service Unavailable");
  const failed = orgLookupProblem("U123456", serverError);
  assert.equal(failed.kind, "ORG_LOOKUP_FAILED");
  assert.match(failed.message, /503/);
  assert.equal(orgLookupProblem("U123456", new TypeError("fetch failed")).kind, "ORG_LOOKUP_FAILED");
});

test("F1: a server too old for the name warning says so and how to go on; another feature has no how-to", () => {
  const warn = serverTooOldProblem(new Err.SchemaServerTooOldError("testSchema(verbose:)", "unknown argument"));
  assert.equal(warn.kind, "SERVER_TOO_OLD");
  assert.match(warn.message, /predates the schema apply feature/);
  assert.equal(warn.howTo, "Run it again without --warn-names.");
  assert.equal(serverTooOldProblem(new Err.SchemaServerTooOldError("testSchema", "unknown field")).howTo, null);
});

test("F3/F9: unknown recipe and unreadable manifest are typed errors", () => {
  assert.equal(unknownRecipeProblem("NOPE", ["LINK_VIEW_GRANTS"]).kind, "UNKNOWN_RECIPE");
  assert.match(unknownRecipeProblem("NOPE", ["LINK_VIEW_GRANTS"]).message, /Use one of: LINK_VIEW_GRANTS/);
  const unreadable = manifestUnreadableProblem("m.yaml", new Error("ENOENT: no such file"));
  assert.equal(unreadable.kind, "MANIFEST_UNREADABLE");
  assert.match(unreadable.message, /^Cannot read m\.yaml: ENOENT/);
  assert.equal(outputExistsProblem("out.yaml").kind, "OUTPUT_EXISTS");
});

test("F10: the exit code is raise-only, and the newline helper adds exactly one", () => {
  assert.equal(raiseExitCode(undefined, 0), 0);
  assert.equal(raiseExitCode(1, 0), 1);
  assert.equal(raiseExitCode(0, 2), 2);
  assert.equal(raiseExitCode(2, 1), 2);
  assert.equal(raiseExitCode("1" as unknown as number, 0), 1);
  assert.equal(withTrailingNewline("a"), "a\n");
  assert.equal(withTrailingNewline("a\n"), "a\n");
});
