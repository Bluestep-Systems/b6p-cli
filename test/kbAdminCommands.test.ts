// End-to-end spec for `b6p kb create` and `b6p kb set`: the bundled CLI (dist/cli.js) against core's FakeGateway,
// with the admin routes (POST, GET /{id}, PATCH /{id}) mounted as extra routes. HOME is a scratch folder.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { FakeGateway } from "@bluestep-systems/b6p-core";

const CLI = path.resolve(__dirname, "../dist/cli.js");
const TOKEN = "b6pt_e2e_admin_0001";
const ID = "7f1c2b9e-0000-4000-8000-0000000000aa";

let gateway: FakeGateway;
let home: string;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function b6p(args: string[], stdin = ""): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
  ifMatch: string | undefined;
  body: unknown;
}

let seen: Seen[] = [];
// The registry row the fake serves: bumped on every PATCH, its version is the ETag.
let row: { name: string; title: string; liveBranch: string; access: string | null; version: number };
// What the next PATCH answers instead of applying, if set.
let omitAccess = false;
let patchFailure: { status: number; body: unknown } | undefined;

function detail(): Record<string, unknown> {
  return {
    id: ID,
    ref: `global/${row.name}`,
    scope: "global",
    name: row.name,
    title: row.title,
    liveBranch: row.liveBranch,
    gitUrl: gateway.gitUrl("knowledge-base", `kb-${row.name}`),
    createdAt: "2026-11-18T10:00:00Z",
    modifiedAt: "2026-11-18T10:00:00Z",
    ...(row.access === null || omitAccess ? {} : { access: { kind: row.access } }),
  };
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let text = "";
    req.on("data", (d: Buffer) => (text += d.toString()));
    req.on("end", () => resolve(text === "" ? undefined : JSON.parse(text)));
  });
}

function reply(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function record(req: http.IncomingMessage, body: unknown): void {
  seen.push({
    method: req.method ?? "",
    url: req.url ?? "",
    authorization: req.headers.authorization,
    ifMatch: req.headers["if-match"] as string | undefined,
    body,
  });
}

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-cli-kbadmin-"));
  gateway = await FakeGateway.start();
  gateway.grantToken(TOKEN, ["kb:read", "kb:manage"], { alias: "laptop", expiresAt: null });
  gateway.knowledgeBases = [
    {
      id: ID,
      status: "ok",
      ref: "global/docs",
      scope: "global",
      tenant: null,
      name: "docs",
      title: "Docs",
      liveBranch: "master",
      canPush: true,
      gitUrl: gateway.gitUrl("knowledge-base", "kb-docs"),
    },
    {
      id: "7f1c2b9e-0000-4000-8000-0000000000bb",
      status: "ok",
      ref: "tenant/U1/notes",
      scope: "tenant",
      tenant: "U1",
      name: "notes",
      title: "Notes",
      liveBranch: "master",
      canPush: false,
      gitUrl: gateway.gitUrl("U1-system", "kb-notes"),
    },
  ];
  gateway.route({
    method: "POST",
    prefix: "/api/v1/knowledge-bases",
    scope: "kb:manage",
    handler: async (req, res) => {
      const body = await readBody(req);
      record(req, body);
      const b = body as { name: string; title?: string; liveBranch?: string; access?: { kind: string } };
      if (b.name === "taken") {
        reply(res, 409, { error: "name-taken", message: "A knowledge base with that name exists" });
        return;
      }
      row = {
        name: b.name,
        title: b.title ?? b.name,
        liveBranch: b.liveBranch ?? "master",
        access: b.access?.kind ?? "private",
        version: 1,
      };
      reply(res, 201, detail(), { ETag: `"v${row.version}"`, Location: `/api/v1/knowledge-bases/${ID}` });
    },
  });
  gateway.route({
    method: "GET",
    prefix: `/api/v1/knowledge-bases/${ID}`,
    scope: "kb:read",
    handler: async (req, res) => {
      record(req, undefined);
      reply(res, 200, { ...detail(), commit: null }, { ETag: `"v${row.version}"` });
    },
  });
  gateway.route({
    method: "PATCH",
    prefix: `/api/v1/knowledge-bases/${ID}`,
    scope: "kb:manage",
    handler: async (req, res) => {
      const body = (await readBody(req)) as { title?: string; liveBranch?: string; access?: { kind: string } };
      record(req, body);
      if (patchFailure !== undefined) {
        reply(res, patchFailure.status, patchFailure.body);
        patchFailure = undefined;
        return;
      }
      if (req.headers["if-match"] !== `"v${row.version}"`) {
        reply(res, 412, { error: "precondition-failed", message: "changed since read" });
        return;
      }
      row = {
        ...row,
        title: body.title ?? row.title,
        liveBranch: body.liveBranch ?? row.liveBranch,
        access: body.access?.kind ?? row.access,
        version: row.version + 1,
      };
      reply(res, 200, detail(), { ETag: `"v${row.version}"` });
    },
  });
  assert.equal((await b6p(["config", "set", "gatewayUrl", gateway.url])).code, 0);
  assert.equal((await b6p(["auth", "set"], `${TOKEN}\n`)).code, 0);
});

after(async () => {
  await gateway.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  seen = [];
  patchFailure = undefined;
  omitAccess = false;
  row = { name: "docs", title: "Docs", liveBranch: "master", access: "private", version: 1 };
});

test("kb create: one POST with what was given, the token as Bearer, and the answer printed", async () => {
  const r = await b6p(["kb", "create", "guides", "--title", "Guides", "--live-branch", "main"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(seen[0].body, { name: "guides", title: "Guides", liveBranch: "main" });
  assert.match(r.stdout, /Created global\/guides/);
  assert.match(r.stdout, /branch: main/);
  assert.match(r.stdout, /access: private/);
});

test("kb create: with only a name, nothing else is sent", async () => {
  const r = await b6p(["kb", "create", "guides"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(seen[0].body, { name: "guides" });
});

test("kb create --access public asks first, naming the knowledge base; Cancel (or nothing) creates nothing", async () => {
  const cancel = await b6p(["kb", "create", "guides", "--access", "public"], "Cancel\n");
  assert.equal(cancel.code, 1);
  assert.match(cancel.stderr, /Anyone on the internet will be able to read guides with no sign-in: every commit reachable from its live branch, including files since deleted/);
  assert.match(cancel.stderr, /Cancelled: guides was not made public/);
  assert.equal(seen.length, 0, "nothing was sent");

  const empty = await b6p(["kb", "create", "guides", "--access", "public"], "\n");
  assert.equal(empty.code, 1);
  assert.equal(seen.length, 0);
});

test("kb create --access public: --yes alone refuses and sends nothing; --confirm-public goes ahead", async () => {
  const yes = await b6p(["--yes", "kb", "create", "guides", "--access", "public"]);
  assert.equal(yes.code, 1);
  assert.match(yes.stderr, /--yes alone never makes a knowledge base public\. Pass --confirm-public/);
  assert.match(yes.stderr, /including files since deleted from it/);
  assert.equal(seen.length, 0);

  const flag = await b6p(["kb", "create", "guides", "--access", "public", "--confirm-public"]);
  assert.equal(flag.code, 0, flag.stderr);
  assert.match(flag.stderr, /Making it public because --confirm-public was passed/);
  assert.deepEqual(seen[0].body, { name: "guides", access: { kind: "public" } });
  seen = [];
  const both = await b6p(["--yes", "kb", "create", "guides", "--access", "public", "--confirm-public"]);
  assert.equal(both.code, 0, both.stderr);
});

test("kb create --access public goes ahead on the explicit answer", async () => {
  const answered = await b6p(["kb", "create", "guides", "--access", "public"], "Make guides public\n");
  assert.equal(answered.code, 0, answered.stderr);
  assert.deepEqual(seen[0].body, { name: "guides", access: { kind: "public" } });
  assert.match(answered.stdout, /access: public/);
});

test("kb create --access private needs no question, and a bad --access is refused before anything is sent", async () => {
  const priv = await b6p(["kb", "create", "guides", "--access", "private"]);
  assert.equal(priv.code, 0, priv.stderr);
  assert.deepEqual(seen[0].body, { name: "guides", access: { kind: "private" } });
  seen = [];
  const bad = await b6p(["kb", "create", "guides", "--access", "world"]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /--access world is not understood\. Use public or private/);
  assert.equal(seen.length, 0);
});

test("kb create: a taken name is reported with its way out; --json carries the knowledge base", async () => {
  const taken = await b6p(["kb", "create", "taken"]);
  assert.equal(taken.code, 1);
  assert.match(taken.stderr, /name-taken/);
  const json = await b6p(["--json", "kb", "create", "guides"]);
  assert.equal(json.code, 0, json.stderr);
  const body = JSON.parse(json.stdout);
  assert.equal(body.knowledgeBase.ref, "global/guides");
  assert.deepEqual(body.knowledgeBase.access, { kind: "private" });
});

test("kb set: resolves the name, reads the ETag, and sends ONE PATCH with If-Match and every given field", async () => {
  const r = await b6p(["kb", "set", "docs", "--title", "Product docs", "--live-branch", "main", "--access", "private"]);
  assert.equal(r.code, 0, r.stderr);
  const patches = seen.filter((s) => s.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.equal(patches[0].ifMatch, '"v1"');
  assert.equal(patches[0].authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(patches[0].body, { title: "Product docs", liveBranch: "main" }, "access was already private");
  assert.match(r.stdout, /Updated global\/docs/);
  assert.match(r.stdout, /title:  Product docs/);
});

test("kb set --access public asks first; Cancel changes nothing; the answer or --confirm-public changes it", async () => {
  const cancel = await b6p(["kb", "set", "docs", "--access", "public"], "Cancel\n");
  assert.equal(cancel.code, 1);
  assert.match(cancel.stderr, /Anyone on the internet will be able to read docs with no sign-in: every commit reachable from its live branch, including files since deleted/);
  assert.equal(seen.filter((s) => s.method === "PATCH").length, 0);

  const ok = await b6p(["kb", "set", "docs", "--access", "public"], "Make docs public\n");
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(seen.find((s) => s.method === "PATCH")?.body, { access: { kind: "public" } });
  assert.match(ok.stdout, /access: public/);

  // Already public: no question, no PATCH.
  seen = [];
  const again = await b6p(["kb", "set", "docs", "--access", "public"]);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /already as asked; nothing changed/);
  assert.equal(seen.filter((s) => s.method === "PATCH").length, 0);

  row.access = "private";
  seen = [];
  const yes = await b6p(["--yes", "kb", "set", "docs", "--access", "public"]);
  assert.equal(yes.code, 1);
  assert.match(yes.stderr, /--yes alone never makes a knowledge base public/);
  assert.equal(seen.filter((s) => s.method === "PATCH").length, 0);
  const flag = await b6p(["kb", "set", "docs", "--access", "public", "--confirm-public"]);
  assert.equal(flag.code, 0, flag.stderr);
  assert.equal(seen.filter((s) => s.method === "PATCH").length, 1);
});

test("kb set with no field is a usage error and sends nothing", async () => {
  const r = await b6p(["kb", "set", "docs"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Nothing to change\. Pass at least one of --title, --live-branch or --access/);
  assert.equal(seen.length, 0);
});

test("kb set: a tenant's knowledge base and an unknown name are refused", async () => {
  const tenant = await b6p(["kb", "set", "U1/notes", "--title", "x"]);
  assert.equal(tenant.code, 1);
  assert.match(tenant.stderr, /tenant knowledge base; only global knowledge bases are managed here/);
  const missing = await b6p(["kb", "set", "nope", "--title", "x"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /No knowledge base "nope"/);
  assert.equal(seen.filter((s) => s.method === "PATCH").length, 0);
});

test("kb set: a 412 says to run it again, a 403 for a missing scope names kb:manage, --json carries changed", async () => {
  patchFailure = { status: 412, body: { error: "precondition-failed", message: "changed since read" } };
  const stale = await b6p(["kb", "set", "docs", "--title", "New"]);
  assert.equal(stale.code, 1);
  assert.match(stale.stderr, /Someone changed the knowledge base after b6p read it/);

  patchFailure = { status: 403, body: { error: "scope-missing", scope: "kb:manage" } };
  const scope = await b6p(["kb", "set", "docs", "--title", "New"]);
  assert.equal(scope.code, 1);
  assert.match(scope.stderr, /lacks the `kb:manage` scope/);

  gateway.failNext({ status: 403, body: { error: "scope-missing", scope: "kb:read" }, method: "GET" });
  const readScope = await b6p(["kb", "set", "docs", "--title", "New"]);
  assert.equal(readScope.code, 1);
  assert.match(readScope.stderr, /lacks the `kb:read` scope/);

  const json = await b6p(["--json", "kb", "set", "docs", "--title", "New"]);
  assert.equal(json.code, 0, json.stderr);
  const body = JSON.parse(json.stdout);
  assert.equal(body.changed, true);
  assert.equal(body.knowledgeBase.title, "New");
});

test("kb set never sends access unless --access was given, and an unknown kind stays unknown", async () => {
  row.access = "scoped";
  const title = await b6p(["kb", "set", "docs", "--title", "New"]);
  assert.equal(title.code, 0, title.stderr);
  const patch = seen.find((s) => s.method === "PATCH");
  assert.deepEqual(patch?.body, { title: "New" }, "no access in the body");
  assert.match(title.stdout, /access: unknown \(a kind this version does not know/);
  assert.equal(row.access, "scoped", "the unknown kind was not rewritten");

  seen = [];
  const same = await b6p(["kb", "set", "docs", "--title", "New"]);
  assert.match(same.stdout, /already as asked/);
  assert.match(same.stdout, /treat it as private/);
  assert.equal(seen.filter((s) => s.method === "PATCH").length, 0);

  seen = [];
  const explicit = await b6p(["kb", "set", "docs", "--access", "private"]);
  assert.equal(explicit.code, 0, explicit.stderr);
  assert.deepEqual(seen.find((s) => s.method === "PATCH")?.body, { access: { kind: "private" } });
});

test("a gateway that sends no access back is reported as not reported, and an access change is not claimed", async () => {
  omitAccess = true;
  const r = await b6p(["kb", "create", "guides", "--access", "private"]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /access: not reported/);
  assert.match(r.stderr, /did not report global\/guides's access, so b6p cannot say it is private/);

  const plain = await b6p(["kb", "create", "plain"]);
  assert.equal(plain.code, 0, plain.stderr);
  assert.match(plain.stdout, /access: not reported/);
});
