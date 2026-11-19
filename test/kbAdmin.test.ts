import { test } from "node:test";
import assert from "node:assert/strict";
import { accessText, describeDetail, parseAccess, publicWarning } from "../src/commands/kb";

test("parseAccess takes public and private, nothing, and refuses the rest", () => {
  assert.deepEqual(parseAccess(undefined), { ok: true, access: undefined });
  assert.deepEqual(parseAccess("public"), { ok: true, access: "public" });
  assert.deepEqual(parseAccess("private"), { ok: true, access: "private" });
  for (const bad of ["Public", "world", ""]) {
    assert.equal(parseAccess(bad).ok, false);
  }
});

const base = { id: "i", ref: "global/docs", name: "docs", title: "Docs", liveBranch: "master", gitUrl: "https://g/x.git" };

test("accessText: not reported when absent, unknown for an unknown kind, never public by guess", () => {
  assert.match(accessText(undefined), /^not reported/);
  assert.match(accessText({ kind: "unknown", rawKind: "scoped", raw: { kind: "scoped" } }), /^unknown .*treat it as private/);
  assert.equal(accessText({ kind: "public" }), "public");
  assert.equal(accessText({ kind: "private" }), "private");
});

test("describeDetail and publicWarning say what matters", () => {
  assert.match(describeDetail(base), /access: not reported/);
  assert.match(describeDetail({ ...base, access: { kind: "public" } }), /access: public/);
  const warning = publicWarning("docs");
  assert.match(warning, /Anyone on the internet will be able to read docs with no sign-in/);
  assert.match(warning, /every commit reachable from its live branch, including files since deleted from it/);
  assert.match(warning, /Anything that was ever committed there becomes public/);
});
