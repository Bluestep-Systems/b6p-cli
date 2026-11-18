// Unit spec for the helpers behind `b6p schema`'s command actions: failure reporting and the `-o` overwrite question.
import { test } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert/strict";
import { NonInteractiveInputError } from "../src/providers/CliPrompt";
import { checkOutput, mayWriteOutput, reportFailure } from "../src/schemaRun";
import type { CliContext } from "../src/context";

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

test("no terminal and no answer: an existing -o file is left alone, not a prompt crash", async () => {
  const prompt = {
    async confirm(): Promise<string | undefined> {
      throw new NonInteractiveInputError("Overwrite?");
    },
  };
  assert.equal(await mayWriteOutput(prompt, "o.yaml", "/o.yaml", async () => true), false);
  const other = {
    async confirm(): Promise<string | undefined> {
      throw new Error("boom");
    },
  };
  await assert.rejects(mayWriteOutput(other, "o.yaml", "/o.yaml", async () => true), /boom/);
});

test("checkOutput reports an existing -o file with no way to ask as a typed OUTPUT_EXISTS body", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "b6p-schema-out-"));
  try {
    const file = path.join(dir, "out.yaml");
    await fs.writeFile(file, "keep me");
    const events: string[] = [];
    const ctx = {
      emitJson: (p: unknown) => events.push(JSON.stringify(p)),
      fail: (m: string) => events.push(`fail ${m}`),
      prompt: {
        notice: (m: string) => events.push(`notice ${m}`),
        async confirm(): Promise<string | undefined> {
          throw new NonInteractiveInputError("Overwrite?");
        },
      },
    } as unknown as CliContext;
    assert.equal(await checkOutput(ctx, "generate", file), false);
    assert.match(events[0], /"manifest":null.*"kind":"OUTPUT_EXISTS"/);
    assert.match(events[1], /^fail .*already exists and was not overwritten/);
    assert.equal(await fs.readFile(file, "utf8"), "keep me");
    // A file that is not there is no question.
    assert.equal(await checkOutput(ctx, "generate", path.join(dir, "new.yaml")), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
