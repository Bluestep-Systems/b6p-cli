import { test } from "node:test";
import assert from "node:assert/strict";
import { Err } from "@bluestep-systems/b6p-core";
import { changeBody, createBody, describeDetail, parseAccess, parseDetail, publicWarning } from "../src/kbAdmin";

test("parseAccess takes public and private, nothing, and refuses the rest", () => {
  assert.deepEqual(parseAccess(undefined), { ok: true, access: undefined });
  assert.deepEqual(parseAccess("public"), { ok: true, access: "public" });
  assert.deepEqual(parseAccess("private"), { ok: true, access: "private" });
  for (const bad of ["Public", "world", ""]) {
    const r = parseAccess(bad);
    assert.equal(r.ok, false);
  }
});

test("request bodies carry only what was given, access as a kind object", () => {
  assert.deepEqual(createBody("docs", {}), { name: "docs" });
  assert.deepEqual(createBody("docs", { title: "T", liveBranch: "main", access: "public" }), {
    name: "docs",
    title: "T",
    liveBranch: "main",
    access: { kind: "public" },
  });
  assert.deepEqual(changeBody({ access: "private" }), { access: { kind: "private" } });
  assert.deepEqual(changeBody({ title: "T" }), { title: "T" });
});

const base = { id: "i", ref: "global/docs", name: "docs", title: "Docs", liveBranch: "master", gitUrl: "https://g/x.git" };

test("parseDetail reads access, and an unknown kind is never public", () => {
  assert.equal(parseDetail({ ...base, access: { kind: "public" } }, "x", 200).access, "public");
  assert.equal(parseDetail({ ...base, access: { kind: "private" } }, "x", 200).access, "private");
  assert.equal(parseDetail({ ...base, access: { kind: "scoped" } }, "x", 200).access, "unknown");
  assert.equal(parseDetail({ ...base, access: "public" }, "x", 200).access, "unknown");
  assert.equal(parseDetail(base, "x", 200).access, null);
});

test("parseDetail refuses a body without a required field, naming the field and no value", () => {
  assert.throws(
    () => parseDetail({ ...base, liveBranch: 3 }, "POST /x", 201),
    (e: unknown) => e instanceof Err.GatewayUnexpectedResponseError && /"liveBranch"/.test(e.message)
  );
  assert.throws(() => parseDetail("nope", "POST /x", 201), Err.GatewayUnexpectedResponseError);
});

test("describeDetail and publicWarning say what matters", () => {
  assert.match(describeDetail(parseDetail({ ...base, access: { kind: "scoped" } }, "x", 200)), /treat it as private/);
  assert.match(describeDetail(parseDetail(base, "x", 200)), /predates public knowledge bases/);
  assert.match(publicWarning("docs"), /Anyone on the internet will be able to read every file in the live branch of docs/);
});
