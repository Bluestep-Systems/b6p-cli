// Unit spec for the helpers behind `b6p schema`'s command actions: failure reporting and the `-o` overwrite question.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mayWriteOutput, reportFailure } from "../src/schemaRun";

function confirmer(answer: string | undefined) {
  const asked: { message: string; options: string[]; opts: unknown }[] = [];
  return {
    asked,
    prompt: {
      async confirm(message: string, options: string[], opts?: unknown): Promise<string | undefined> {
        asked.push({ message, options, opts });
        return answer;
      },
    },
  };
}

test("F8: a new -o file is written without a question", async () => {
  const c = confirmer("Overwrite");
  assert.equal(await mayWriteOutput(c.prompt, "out.yaml", "/x/out.yaml", async () => false), true);
  assert.equal(c.asked.length, 0);
});

test("F8: an existing -o file asks a destructive question whose safe answer is Cancel", async () => {
  const c = confirmer("Overwrite");
  assert.equal(await mayWriteOutput(c.prompt, "out.yaml", "/x/out.yaml", async () => true), true);
  assert.equal(c.asked.length, 1);
  assert.match(c.asked[0].message, /out\.yaml already exists/);
  assert.deepEqual(c.asked[0].options, ["Cancel", "Overwrite"]);
  assert.deepEqual(c.asked[0].opts, { destructive: true, safeOption: "Cancel" });
});

test("F8: Cancel, an empty answer or an unmatched one leaves an existing file alone", async () => {
  for (const answer of ["Cancel", undefined]) {
    assert.equal(await mayWriteOutput(confirmer(answer).prompt, "o", "/o", async () => true), false);
  }
});

test("F8: --yes (CliPrompt answers a destructive question with its safe choice) never overwrites", async () => {
  const { CliPrompt } = await import("../src/providers/CliPrompt");
  const lines: string[] = [];
  const prompt = new CliPrompt({ autoYes: true, output: { write: (s: string) => lines.push(s) } as never });
  try {
    assert.equal(await mayWriteOutput(prompt, "o.yaml", "/o.yaml", async () => true), false);
  } finally {
    prompt.close();
  }
  assert.match(lines.join(""), /answered by --yes: the safe choice/);
});

test("F3: reportFailure emits the family body, fails, and prints the how-to", () => {
  const events: string[] = [];
  const ctx = {
    emitJson: (p: unknown) => events.push(`json ${JSON.stringify(p)}`),
    fail: (m: string) => events.push(`fail ${m}`),
    prompt: { notice: (m: string) => events.push(`notice ${m}`) },
  };
  reportFailure(ctx, "test", { kind: "ORG_UNKNOWN", message: "no org", howTo: "pass --org" });
  assert.equal(events.length, 3);
  assert.match(events[0], /^json .*"passed":false.*"error":\{"kind":"ORG_UNKNOWN"/);
  assert.equal(events[1], "fail no org");
  assert.equal(events[2], "notice pass --org");
  const quiet: string[] = [];
  reportFailure({ ...ctx, emitJson: () => undefined, fail: (m) => quiet.push(m), prompt: { notice: (m) => quiet.push(m) } }, "generate", {
    kind: "SUPER_ONLY",
    message: "m",
    howTo: null,
  });
  assert.deepEqual(quiet, ["m"]);
});
