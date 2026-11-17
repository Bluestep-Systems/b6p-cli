// The commit author: --author / the "author" setting / a deploy config's author (CU-86bd2nrvf).
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  AuthorFormatError,
  chooseAuthor,
  planDeployAuthor,
  isMissingAuthorError,
  missingAuthorMessage,
  parseAuthor,
} from "../src/author";

const JANE = { name: "Jane Doe", email: "jane@example.com" };
const JOE = { name: "Joe Roe", email: "joe@example.com" };

describe("parseAuthor", () => {
  it("reads Name <email>, trimming spaces", () => {
    assert.deepStrictEqual(parseAuthor("Jane Doe <jane@example.com>", "--author"), JANE);
    assert.deepStrictEqual(parseAuthor("  Jane Doe   < jane@example.com >  ", "--author"), JANE);
  });

  it("rejects text that is not Name <email>, naming the origin and the expected shape", () => {
    for (const bad of ["Jane Doe", "<jane@example.com>", "jane@example.com", "Jane <not-an-email>", ""]) {
      assert.throws(
        () => parseAuthor(bad, "--author"),
        (e: unknown) =>
          e instanceof AuthorFormatError && /--author must look like "Jane Doe <jane@example.com>"/.test(e.message),
        bad
      );
    }
  });
});

describe("chooseAuthor", () => {
  it("prefers --author over the setting", () => {
    assert.deepStrictEqual(chooseAuthor("Joe Roe <joe@example.com>", "Jane Doe <jane@example.com>"), JOE);
  });

  it("falls back to the setting", () => {
    assert.deepStrictEqual(chooseAuthor(undefined, "Jane Doe <jane@example.com>"), JANE);
  });

  it("is undefined with neither, leaving core to read git config and the environment", () => {
    assert.strictEqual(chooseAuthor(undefined, undefined), undefined);
    assert.strictEqual(chooseAuthor(undefined, null), undefined);
  });

  it("rejects a malformed or non-text setting with the fix spelled out", () => {
    assert.throws(() => chooseAuthor(undefined, "nobody"), /"author" setting must look like/);
    assert.throws(() => chooseAuthor(undefined, 42), /b6p config set author "Jane Doe <jane@example.com>"/);
  });
});

describe("missing author", () => {
  it("recognizes core's IDENTITY_REQUIRED error by code", () => {
    const e = Object.assign(new Error("No commit author found"), { code: "IDENTITY_REQUIRED" });
    assert.strictEqual(isMissingAuthorError(e), true);
    assert.strictEqual(isMissingAuthorError(new Error("boom")), false);
    assert.strictEqual(isMissingAuthorError("IDENTITY_REQUIRED"), false);
  });

  it("spells out every way to fix it", () => {
    const text = missingAuthorMessage("No commit author found");
    assert.match(text, /--author "Jane Doe <jane@example.com>"/);
    assert.match(text, /b6p config set author/);
    assert.match(text, /git config --global user\.name/);
    assert.match(text, /GIT_AUTHOR_NAME and GIT_AUTHOR_EMAIL/);
  });
});

describe("planDeployAuthor", () => {
  const base = { sourceRootPath: "/s", targets: [{ url: "u" }], message: "m" };
  const text = (extra: object = {}) => JSON.stringify({ ...base, ...extra });

  it("leaves a config alone and names no author when nothing chose one", () => {
    const plan = planDeployAuthor(text(), undefined, undefined);
    assert.deepStrictEqual([plan.text, plan.author, plan.sourceRootPath], [null, undefined, "/s"]);
  });

  it("leaves a config alone when its own object author wins", () => {
    const plan = planDeployAuthor(text({ author: JANE }), undefined, "Joe Roe <joe@example.com>");
    assert.strictEqual(plan.text, null);
    assert.deepStrictEqual(plan.author, JANE);
  });

  it("adds the setting's author when the file has none, keeping every other field", () => {
    const plan = planDeployAuthor(text(), undefined, "Jane Doe <jane@example.com>");
    assert.deepStrictEqual(JSON.parse(plan.text ?? "null"), { ...base, author: JANE });
  });

  it("--author overrides the file's author and the setting", () => {
    const plan = planDeployAuthor(text({ author: JANE }), "Joe Roe <joe@example.com>", "Jane Doe <jane@example.com>");
    assert.deepStrictEqual(JSON.parse(plan.text ?? "null").author, JOE);
  });

  it("converts a Name <email> author in the file to core's object form", () => {
    const plan = planDeployAuthor(text({ author: "Jane Doe <jane@example.com>" }), undefined, undefined);
    assert.deepStrictEqual(JSON.parse(plan.text ?? "null").author, JANE);
  });

  it("a bad lower-priority source never blocks a valid higher one", () => {
    // A garbage setting under a valid --author, and under a valid file author.
    assert.deepStrictEqual(planDeployAuthor(text(), "Joe Roe <joe@example.com>", "garbage").author, JOE);
    assert.deepStrictEqual(planDeployAuthor(text({ author: JANE }), undefined, 42).author, JANE);
    // A malformed file author under a valid --author.
    assert.deepStrictEqual(
      planDeployAuthor(text({ author: "nobody" }), "Joe Roe <joe@example.com>", undefined).author,
      JOE
    );
  });

  it("rejects a malformed winning source", () => {
    assert.throws(() => planDeployAuthor(text({ author: "nobody" }), undefined, undefined), AuthorFormatError);
    assert.throws(() => planDeployAuthor(text({ author: { name: "x" } }), undefined, undefined), AuthorFormatError);
    assert.throws(() => planDeployAuthor(text(), "nobody", undefined), AuthorFormatError);
    assert.throws(() => planDeployAuthor(text(), undefined, "nobody"), AuthorFormatError);
  });

  it("passes unparseable or non-object files through for core to report", () => {
    assert.strictEqual(planDeployAuthor("{not json", "Jane Doe <jane@example.com>", undefined).text, null);
    assert.strictEqual(planDeployAuthor("[]", "Jane Doe <jane@example.com>", undefined).text, null);
  });
});
