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
  gateway.grantToken(TOKEN, ["kb:read", "kb:push", "registry:read", "tokens:self"], { alias: "laptop", expiresAt: null });
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
  assert.equal(body.secret, body.token, "the secret is always the top-level `secret` field");
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

test("auth token create: --expires takes a date or a full date-time, and refuses the rest locally", async () => {
  const before = gateway.requests.length;
  for (const bad of ["2099-01-01T00:00", "2099-01-01T00:00:00", "2099-02-31"]) {
    const r = await b6p(["auth", "token", "create", "--alias", "d", "--scopes", "kb:read", "--expires", bad]);
    assert.equal(r.code, 1, bad);
    assert.match(r.stderr, /not understood/);
  }
  assert.equal(gateway.requests.length, before, "a refused --expires sends nothing");

  const date = await b6p([
    "--json",
    "auth",
    "token",
    "create",
    "--alias",
    "d1",
    "--scopes",
    "kb:read",
    "--expires",
    "2099-01-01",
  ]);
  assert.equal(date.code, 0, date.stderr);
  assert.equal(new Date(JSON.parse(date.stdout).expiresAt).toISOString(), "2099-01-01T00:00:00.000Z");
  const stamp = await b6p([
    "--json",
    "auth",
    "token",
    "create",
    "--alias",
    "d2",
    "--scopes",
    "kb:read",
    "--expires",
    "2099-01-01T12:00:00+02:00",
  ]);
  assert.equal(stamp.code, 0, stamp.stderr);
  assert.equal(new Date(JSON.parse(stamp.stdout).expiresAt).toISOString(), "2099-01-01T10:00:00.000Z");
});

test("kb push and pull, and marketplace pull, hand core the user's cwd: a relative folder is not refused", async () => {
  // No git server is mounted, so each fails later than argument checking. What this pins is that the
  // failure is not core's "needs an absolute path / cwd" refusal (GatewayInvalidArgumentError).
  gateway.repos = [
    { name: "core", description: "", defaultBranch: "master", tags: [], gitUrl: gateway.gitUrl("marketplace", "core") },
  ];
  const runs = [
    await b6p(["kb", "push", "some-relative-dir"]),
    await b6p(["kb", "pull", "onboarding", "rel-kb-dir"]),
    await b6p(["marketplace", "pull", "core", "rel-mp-dir", "--ref", "refs/tags/v1.0.0"]),
  ];
  for (const r of runs) {
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.stderr, /absolute/i, r.stderr);
  }
});

test("auth token create: alias clash and bad --expires fail non-zero", async () => {
  const clash = await b6p(["auth", "token", "create", "--alias", "ci", "--scopes", "kb:read"]);
  assert.equal(clash.code, 1);
  assert.match(clash.stderr, /another --alias/);
  assert.doesNotMatch(clash.stderr, /rotate/);

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
  assert.equal(body.secret, body.token.token, "the secret is always the top-level `secret` field");

  // The stored token is now the new one, so the next call still works.
  const after = await b6p(["kb", "list"]);
  assert.equal(after.code, 0, after.stderr);
});

test("revoking another token, and rotating any token, ask nothing", async () => {
  const made = await b6p(["--json", "auth", "token", "create", "--alias", "tmp", "--scopes", "kb:read"]);
  assert.equal(made.code, 0, made.stderr);
  // No stdin and no --yes: a prompt would fail on end of input, so success proves none was asked.
  const revoked = await b6p(["auth", "token", "revoke", "--tokenid", "tmp"]);
  assert.equal(revoked.code, 0, revoked.stderr);
  assert.doesNotMatch(revoked.stderr, /locks b6p out/);
});

test("revoking the stored token asks first: --yes alone and no input decline and send no DELETE", async () => {
  const deletes = () => gateway.requests.filter((r) => r.method === "DELETE").length;
  const before = deletes();

  const yes = await b6p(["--yes", "auth", "token", "revoke", "--tokenid", "laptop"]);
  assert.equal(yes.code, 1);
  assert.match(yes.stderr, /locks b6p out/);
  assert.match(yes.stderr, /Cancelled/);

  const empty = await b6p(["auth", "token", "revoke", "--tokenid", "laptop"], "\n");
  assert.equal(empty.code, 1, "an empty answer is Cancel");

  const json = await b6p(["--json", "auth", "token", "revoke", "--tokenid", "laptop"]);
  assert.equal(json.code, 1, "no input under --json fails");
  const body = JSON.parse(json.stdout);
  assert.equal(typeof body.error, "string");
  assert.deepEqual(body.errors, [body.error]);

  assert.equal(deletes(), before, "nothing was revoked");
  const still = await b6p(["kb", "list"]);
  assert.equal(still.code, 0, "the stored token still works");
});

test("confirming revokes the stored token, warns, and later calls fail with advice", async () => {
  const r = await b6p(["auth", "token", "revoke", "--tokenid", "laptop"], "Revoke\n");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /dead token/);

  const dead = await b6p(["kb", "list"]);
  assert.equal(dead.code, 1);
  assert.match(dead.stderr, /b6p auth set/);

  const gone = await b6p(["auth", "token", "revoke", "--tokenid", "nope"]);
  assert.equal(gone.code, 1);
});

/** Grant `secret` as a token of its own, store it for the CLI, and return its secret. */
async function useToken(
  secret: string,
  alias: string,
  expiresAt: string | null,
  scopes = ["kb:read", "registry:read", "tokens:self"]
): Promise<void> {
  gateway.grantToken(secret, scopes, { alias, expiresAt });
  const saved = await b6p(["auth", "set"], `${secret}\n`);
  assert.equal(saved.code, 0, saved.stderr);
}

const inDays = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString();

test("auth token create with no --expires is capped at the stored token's expiry, and says so", async () => {
  const expiry = inDays(10);
  await useToken("b6pt_e2e_short_0003", "short", expiry);
  const human = await b6p(["auth", "token", "create", "--alias", "capped", "--scopes", "kb:read"]);
  assert.equal(human.code, 0, human.stderr);
  assert.match(human.stdout.trim(), /^b6pt_\S+$/, "the secret is still alone on stdout");
  assert.match(human.stderr, /would have outlived the token b6p is using/);
  assert.ok(human.stderr.includes(`on ${expiry}`), human.stderr);
  assert.ok(!human.stderr.includes(human.stdout.trim()));

  const json = await b6p(["--json", "auth", "token", "create", "--alias", "capped2", "--scopes", "kb:read"]);
  assert.equal(json.code, 0, json.stderr);
  const body = JSON.parse(json.stdout);
  assert.equal(body.expiresAt, expiry);
  assert.deepEqual(body.expiryCapped, { cappedTo: expiry, requested: "90d" });

  // A token that expires sooner than the stored one is sent as asked and is not "capped".
  const early = await b6p(["--json", "auth", "token", "create", "--alias", "early", "--scopes", "kb:read", "--expires", "3d"]);
  assert.equal(early.code, 0, early.stderr);
  assert.equal(JSON.parse(early.stdout).expiryCapped, null);
});

test("auth token create: an --expires that outlives the stored token is refused and explained", async () => {
  const expiry = inDays(10);
  await useToken("b6pt_e2e_short_0004", "short2", expiry);
  const later = await b6p(["auth", "token", "create", "--alias", "long", "--scopes", "kb:read", "--expires", "40d"]);
  assert.equal(later.code, 1);
  assert.equal(later.stdout, "", "no secret was minted");
  assert.match(later.stderr, /cannot outlive the one that creates it/);
  assert.ok(later.stderr.includes(`expires ${expiry}`), later.stderr);
  assert.match(later.stderr, /--expires before/);

  // Ruling 26 keeps its confirmation; the refusal comes after it.
  const never = await b6p(["--yes", "--json", "auth", "token", "create", "--alias", "forever-capped", "--scopes", "kb:read", "--expires", "never"]);
  assert.equal(never.code, 1);
  const body = JSON.parse(never.stdout);
  assert.match(body.error, /never expires/);
  assert.match(body.error, /cannot outlive/);
  assert.deepEqual(body.errors, [body.error]);
});

test("auth token create at the 50-token limit explains how to free one, and works after a revoke", async () => {
  // Its own owner, so the other tests' tokens do not count toward the limit.
  const scopes = ["kb:read", "tokens:self"];
  gateway.grantToken("b6pt_e2e_full_0005", scopes, { alias: "full", expiresAt: null, owner: "limit-user" });
  assert.equal((await b6p(["auth", "set"], "b6pt_e2e_full_0005\n")).code, 0);
  for (let n = 0; n < 49; n++) {
    gateway.grantToken(`b6pt_e2e_filler_${n}`, ["kb:read"], { alias: `filler-${n}`, expiresAt: null, owner: "limit-user" });
  }
  const full = await b6p(["auth", "token", "create", "--alias", "one-too-many", "--scopes", "kb:read"]);
  assert.equal(full.code, 1);
  assert.equal(full.stdout, "");
  assert.match(full.stderr, /maximum of 50 live tokens/);
  assert.match(full.stderr, /b6p auth token revoke --tokenid <alias>/);

  const freed = await b6p(["auth", "token", "revoke", "--tokenid", "filler-0"]);
  assert.equal(freed.code, 0, freed.stderr);
  const again = await b6p(["auth", "token", "create", "--alias", "one-too-many", "--scopes", "kb:read"]);
  assert.equal(again.code, 0, again.stderr);
});

test("auth token list marks expired tokens and an unknown createdAt, in both forms", async () => {
  gateway.grantToken("b6pt_e2e_expired_01", ["kb:read"], {
    alias: "gone",
    id: "tok_gone",
    owner: "limit-user",
    createdAt: null,
    expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
  });
  const human = await b6p(["auth", "token", "list"]);
  assert.equal(human.code, 0, human.stderr);
  const row = human.stdout.split("\n").find((l) => /\bgone\b/.test(l));
  assert.ok(row !== undefined, human.stdout);
  assert.match(row, /unknown/);
  assert.match(row, /\(expired\)/);
  assert.match(human.stdout, /CREATED/);
  assert.match(human.stdout, /LAST USED \(approx\.\)/);

  const json = await b6p(["--json", "auth", "token", "list"]);
  const gone = JSON.parse(json.stdout).tokens.find((t: { alias: string }) => t.alias === "gone");
  assert.equal(gone.createdAt, null);
  assert.equal(gone.expired, true);
  const current = JSON.parse(json.stdout).tokens.find((t: { current: boolean }) => t.current);
  assert.equal(current.expired, false);
});

test("a 400 invalid-request, a bare 403 on a mint and a 503 registry-unavailable are each explained", async () => {
  await useToken("b6pt_e2e_reg_0006", "reg", null);
  gateway.failNext({ method: "POST", status: 400, body: { error: "invalid-request", message: "bad alias" } });
  const bad = await b6p(["auth", "token", "create", "--alias", "badreq", "--scopes", "kb:read"]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /rejected what was sent/);

  gateway.restrictedMintsDisabled = true;
  const refused = await b6p(["auth", "token", "create", "--alias", "r", "--scopes", "kb:read", "--expires", "1d"]);
  gateway.restrictedMintsDisabled = false;
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, "");
  assert.match(refused.stderr, /not enabled yet/);
  assert.match(refused.stderr, /mcp/);
  assert.doesNotMatch(refused.stderr, /cannot outlive/);

  gateway.failNext({ method: "POST", status: 403, body: { error: "not-permitted", reason: "something-new", message: "m" } });
  const unknown = await b6p(["auth", "token", "create", "--alias", "r2", "--scopes", "kb:read", "--expires", "1d"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /not allowed/);
  assert.doesNotMatch(unknown.stderr, /not enabled yet|rolled out/);

  gateway.failNext({ status: 503, body: { error: "registry-unavailable", message: "m" } });
  const registry = await b6p(["marketplace", "list"]);
  assert.equal(registry.code, 1);
  assert.match(registry.stderr, /web-global/);
  const asJson = await b6p(["--json", "marketplace", "list"]);
  assert.equal(asJson.code, 0, "the next call works again");
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
  assert.deepEqual(body.errors, [body.error], "the documented failure body is kept");
});
