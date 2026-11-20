// End-to-end spec for `b6p marketplace create`: the bundled CLI (dist/cli.js) against core's FakeGateway, which
// serves POST /api/v1/registry/repos. HOME is a scratch folder.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FakeGateway } from "@bluestep-systems/b6p-core";
import { isolatedEnv } from "./isolatedEnv";

const CLI = path.resolve(__dirname, "../dist/cli.js");
const SUPER = "b6pt_e2e_mpcreate_0001";
const NO_PUSH = "b6pt_e2e_mpcreate_0002";

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
      env: isolatedEnv(home),
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

async function useToken(token: string): Promise<void> {
  assert.equal((await b6p(["auth", "set"], `${token}\n`)).code, 0);
}

function posts(): { url: string; body: unknown }[] {
  return gateway.requests
    .filter((r) => r.method === "POST" && r.path === "/api/v1/registry/repos")
    .map((r) => ({ url: r.path, body: JSON.parse(String(r.body)) }));
}

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-cli-mpcreate-"));
  gateway = await FakeGateway.start();
  gateway.grantToken(SUPER, ["registry:read", "registry:push"], { alias: "super", expiresAt: null });
  gateway.grantToken(NO_PUSH, ["registry:read"], { alias: "reader", expiresAt: null });
  assert.equal((await b6p(["config", "set", "gatewayUrl", gateway.url])).code, 0);
  await useToken(SUPER);
});

after(async () => {
  await gateway.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(async () => {
  gateway.emptyRepos.clear();
  gateway.requests.length = 0;
});

test("create: prints the name, clone URL and the first-push steps, and says it was created", async () => {
  const r = await b6p(["marketplace", "create", "kb"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Created marketplace repository kb/);
  assert.match(r.stdout, new RegExp(`Clone URL: ${gateway.gitUrl("marketplace", "kb").replace(/[.]/g, "\\.")}`));
  assert.match(r.stdout, /push main alone first: `git push \S+ main`, then its tags in a second push/);
  assert.match(r.stdout, /not show in `b6p marketplace list` until that first push/);
});

test("create: sends only the options given", async () => {
  assert.equal((await b6p(["marketplace", "create", "bare"])).code, 0);
  assert.deepEqual(posts()[0].body, { name: "bare" });

  const r = await b6p([
    "marketplace",
    "create",
    "full",
    "--description",
    "Full one",
    "--website",
    "https://example.com",
    "--topic",
    "kb",
    "--topic",
    "react",
  ]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(posts()[1].body, {
    name: "full",
    description: "Full one",
    website: "https://example.com",
    topics: ["kb", "react"],
  });
});

test("create: an existing empty repo is adopted, and the output says so plainly", async () => {
  assert.equal((await b6p(["marketplace", "create", "again"])).code, 0);
  const r = await b6p(["marketplace", "create", "again"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Adopted the existing empty marketplace repository again/);
  assert.match(r.stdout, /nothing was created/);
  assert.doesNotMatch(r.stdout, /Created marketplace repository/);
  assert.match(r.stdout, /Clone URL:/);
});

test("create --json: the repo and whether it was created", async () => {
  const first = JSON.parse((await b6p(["--json", "marketplace", "create", "j"])).stdout);
  assert.equal(first.created, true);
  assert.equal(first.repo.name, "j");
  assert.equal(first.repo.gitUrl, gateway.gitUrl("marketplace", "j"));
  const second = JSON.parse((await b6p(["--json", "marketplace", "create", "j"])).stdout);
  assert.equal(second.created, false);
});

test("create: a bad name is refused before anything is sent", async () => {
  const r = await b6p(["marketplace", "create", "Bad Name"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.notEqual(r.stderr, "");
  assert.equal(posts().length, 0);
});

test("create: 409 repo-exists says to choose another name", async () => {
  gateway.failNext({ method: "POST", status: 409, body: { error: "repo-exists", message: "kb holds history" } });
  const r = await b6p(["marketplace", "create", "kb"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /kb holds history/);
  assert.match(r.stderr, /history, an archived repository, or one that differs only in case/);
  assert.match(r.stderr, /Choose another name/);
});

test("create: 409 rewrite-in-progress says to retry shortly", async () => {
  gateway.failNext({ method: "POST", status: 409, body: { error: "rewrite-in-progress", message: "busy" } });
  const r = await b6p(["marketplace", "create", "kb"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /under way/);
  assert.match(r.stderr, /try again shortly/);
});

test("create: a token without registry:push is told which scope to mint, in kb's words", async () => {
  await useToken(NO_PUSH);
  try {
    const r = await b6p(["marketplace", "create", "kb"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /lacks the `registry:push` scope/);
    assert.match(r.stderr, /Mint a token with `registry:push`/);
    assert.match(r.stderr, /b6p auth set/);
    assert.doesNotMatch(r.stderr, /auth refresh/);
  } finally {
    await useToken(SUPER);
  }
});

test("create: 403 not-permitted says only fleet super users may create, and --json carries the fields", async () => {
  gateway.failNext({ method: "POST", status: 403, body: { error: "not-permitted", message: "no" } });
  const r = await b6p(["marketplace", "create", "kb"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Only fleet super users may create marketplace repositories/);

  gateway.failNext({ method: "POST", status: 403, body: { error: "not-permitted", message: "no" } });
  const j = await b6p(["--json", "marketplace", "create", "kb"]);
  assert.equal(j.code, 1);
  assert.equal(JSON.parse(j.stdout).code, "not-permitted");
});

test("create: 400 invalid-request shows the gateway's message", async () => {
  gateway.failNext({
    method: "POST",
    status: 400,
    body: { error: "invalid-request", message: "topics[0] is not a topic" },
  });
  const r = await b6p(["marketplace", "create", "kb"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /topics\[0\] is not a topic/);
});

test("create: 502 forge-unavailable says the forge is unavailable and to retry", async () => {
  gateway.failNext({ method: "POST", status: 502, body: { error: "forge-unavailable", message: "forge down" } });
  const r = await b6p(["marketplace", "create", "kb"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /forge down/);
  assert.match(r.stderr, /forge behind the gateway is unavailable/);
  assert.match(r.stderr, /Try again later/);
});
