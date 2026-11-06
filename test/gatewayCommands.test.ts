// End-to-end spec: the bundled CLI (dist/cli.js, built by `pretest`) against core's FakeGateway.
// Covers kb list, token create / list / rotate / revoke, and the failure exit codes. HOME points at a
// scratch folder so the stored token and settings never touch the real ~/.b6p.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FakeGateway } from "@bluestep-systems/b6p-core";

const CLI = path.resolve(__dirname, "../dist/cli.js");
const TOKEN = "b6pt_e2e_token_0001";

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

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-cli-gw-"));
  gateway = await FakeGateway.start();
  gateway.grantToken(TOKEN, ["kb:read", "kb:push", "registry:read", "tokens:self"], { alias: "laptop" });
  gateway.knowledgeBases = [
    {
      ref: "global/onboarding",
      scope: "global",
      tenant: null,
      name: "onboarding",
      title: "Onboarding",
      liveBranch: "master",
      canPush: true,
      gitUrl: gateway.gitUrl("knowledge-base", "kb-onboarding"),
    },
  ];
  assert.equal((await b6p(["config", "set", "gatewayUrl", gateway.url])).code, 0);
  assert.equal((await b6p(["auth", "set"], `${TOKEN}\n`)).code, 0);
});

after(async () => {
  await gateway.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

test("kb list prints a table, and --json the listing", async () => {
  const human = await b6p(["kb", "list"]);
  assert.equal(human.code, 0, human.stderr);
  assert.match(human.stdout, /global\/onboarding\s+Onboarding\s+master\s+yes/);

  const json = await b6p(["--json", "kb", "list"]);
  assert.equal(json.code, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).knowledgeBases[0].ref, "global/onboarding");
});

test("kb list rejects a bad --scope with a non-zero exit", async () => {
  const r = await b6p(["kb", "list", "--scope", "everything"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--scope everything is not understood/);
});

test("a missing scope fails with the scope to mint", async () => {
  const other = "b6pt_e2e_noscope_01";
  gateway.grantToken(other, ["registry:read"], { alias: "weak" });
  const saved = await b6p(["auth", "set"], `${other}\n`);
  assert.equal(saved.code, 0, saved.stderr);
  try {
    const r = await b6p(["kb", "list"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /kb:read/);
  } finally {
    await b6p(["auth", "set"], `${TOKEN}\n`);
  }
});

test("auth token create prints the secret once on stdout, and --json carries it", async () => {
  const r = await b6p(["auth", "token", "create", "--alias", "ci", "--scopes", "kb:read"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout.trim(), /^b6pt_\S+$/);
  assert.match(r.stderr, /Store this token now/);
  assert.ok(!r.stderr.includes(r.stdout.trim()), "the secret must not be echoed to stderr");

  const j = await b6p([
    "--json",
    "auth",
    "token",
    "create",
    "--alias",
    "ci2",
    "--scopes",
    "kb:read",
    "--expires",
    "30d",
  ]);
  assert.equal(j.code, 0, j.stderr);
  const body = JSON.parse(j.stdout);
  assert.match(body.token, /^b6pt_/);
  assert.equal(body.neverExpires, false);
});

test("auth token create: --expires never goes ahead under --yes only because it was explicit", async () => {
  const noYes = await b6p(
    ["auth", "token", "create", "--alias", "forever-no", "--scopes", "kb:read", "--expires", "never"],
    "\n"
  );
  assert.equal(noYes.code, 1, "an empty answer declines");
  assert.match(noYes.stderr, /never expires/);

  const yes = await b6p([
    "--yes",
    "--json",
    "auth",
    "token",
    "create",
    "--alias",
    "forever",
    "--scopes",
    "kb:read",
    "--expires",
    "never",
  ]);
  assert.equal(yes.code, 0, yes.stderr);
  assert.equal(JSON.parse(yes.stdout).neverExpires, true);
});

test("auth token create: alias clash and bad --expires fail non-zero", async () => {
  const clash = await b6p(["auth", "token", "create", "--alias", "ci", "--scopes", "kb:read"]);
  assert.equal(clash.code, 1);
  assert.match(clash.stderr, /rotate/);

  const bad = await b6p(["auth", "token", "create", "--alias", "x", "--scopes", "kb:read", "--expires", "tomorrow"]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /not understood/);
});

test("auth token list marks the current token; rotate of it re-stores the new secret", async () => {
  const list = await b6p(["--json", "auth", "token", "list"]);
  assert.equal(list.code, 0, list.stderr);
  const current = JSON.parse(list.stdout).tokens.find((t: { current: boolean }) => t.current);
  assert.equal(current.alias, "laptop");

  const rotated = await b6p(["--json", "auth", "token", "rotate", "--tokenid", "laptop"]);
  assert.equal(rotated.code, 0, rotated.stderr);
  const body = JSON.parse(rotated.stdout);
  assert.equal(body.rotatedCurrent, true);
  assert.notEqual(body.token.token, TOKEN);

  // The stored token is now the new one, so the next call still works.
  const after = await b6p(["kb", "list"]);
  assert.equal(after.code, 0, after.stderr);
});

test("auth token revoke warns when it revokes the token b6p holds, then calls fail with advice", async () => {
  const r = await b6p(["auth", "token", "revoke", "--tokenid", "laptop"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /dead token/);

  const dead = await b6p(["kb", "list"]);
  assert.equal(dead.code, 1);
  assert.match(dead.stderr, /b6p auth set/);

  const gone = await b6p(["auth", "token", "revoke", "--tokenid", "nope"]);
  assert.equal(gone.code, 1);
});

test("an off-contract create still shows the minted secret once, then fails", async () => {
  const fresh = "b6pt_e2e_fresh_0002";
  gateway.grantToken(fresh, ["kb:read", "tokens:self"], { alias: "fresh" });
  assert.equal((await b6p(["auth", "set"], `${fresh}\n`)).code, 0);
  gateway.route({
    method: "POST",
    prefix: "/api/v1/tokens",
    scope: "tokens:self",
    handler: (_req, res) => {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: "b6pt_recovered_secret_9", alias: 42 }));
    },
  });
  const r = await b6p(["auth", "token", "create", "--alias", "weird", "--scopes", "kb:read"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout.trim(), "b6pt_recovered_secret_9");
  assert.ok(!r.stderr.includes("b6pt_recovered_secret_9"), "the secret goes to stdout only");
  assert.match(r.stderr, /Store it now/);

  const j = await b6p(["--json", "auth", "token", "create", "--alias", "weird2", "--scopes", "kb:read"]);
  assert.equal(j.code, 1);
  const body = JSON.parse(j.stdout);
  assert.equal(body.secret, "b6pt_recovered_secret_9");
  assert.equal(body.operation, "create");
});
