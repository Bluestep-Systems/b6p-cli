// The commit author: --author / the "author" setting / a deploy config's author (CU-86bd2nrvf).
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  AuthorFormatError,
  chooseAuthor,
  deployConfigWithAuthor,
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

describe("deployConfigWithAuthor", () => {
  const base = { sourceRootPath: "/s", targets: [{ url: "u" }], message: "m" };

  it("leaves a config alone when nothing chose an author", () => {
    assert.strictEqual(deployConfigWithAuthor(JSON.stringify(base), undefined, undefined), null);
  });

  it("leaves a config alone when its own object author is the winner", () => {
    assert.strictEqual(deployConfigWithAuthor(JSON.stringify({ ...base, author: JANE }), undefined, JOE), null);
  });

  it("adds the setting's author when the file has none, keeping every other field", () => {
    const out = JSON.parse(deployConfigWithAuthor(JSON.stringify(base), undefined, JANE) ?? "null");
    assert.deepStrictEqual(out, { ...base, author: JANE });
  });

  it("--author overrides the file's author and the setting", () => {
    const out = JSON.parse(deployConfigWithAuthor(JSON.stringify({ ...base, author: JANE }), JOE, JANE) ?? "null");
    assert.deepStrictEqual(out.author, JOE);
  });

  it("converts a Name <email> author in the file to core's object form", () => {
    const out = JSON.parse(
      deployConfigWithAuthor(
        JSON.stringify({ ...base, author: "Jane Doe <jane@example.com>" }),
        undefined,
        undefined
      ) ?? "null"
    );
    assert.deepStrictEqual(out.author, JANE);
  });

  it("rejects a malformed author in the file", () => {
    assert.throws(
      () => deployConfigWithAuthor(JSON.stringify({ ...base, author: "nobody" }), undefined, undefined),
      AuthorFormatError
    );
    assert.throws(
      () => deployConfigWithAuthor(JSON.stringify({ ...base, author: { name: "x" } }), undefined, undefined),
      AuthorFormatError
    );
  });

  it("passes unparseable or non-object files through for core to report", () => {
    assert.strictEqual(deployConfigWithAuthor("{not json", JANE, undefined), null);
    assert.strictEqual(deployConfigWithAuthor("[]", JANE, undefined), null);
  });
});
