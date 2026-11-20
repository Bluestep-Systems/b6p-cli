// End-to-end spec for the `b6p marketplace` lifecycle commands (get, edit, archive, unarchive, rename, delete,
// tombstones, purge): the bundled CLI (dist/cli.js) against core's FakeGateway. HOME is a scratch folder.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FakeGateway, type GatewayMarketplaceRepo } from "@bluestep-systems/b6p-core";
import { isolatedEnv } from "./isolatedEnv";

const CLI = path.resolve(__dirname, "../dist/cli.js");
const SUPER = "b6pt_e2e_mplife_0001";
const NO_PUSH = "b6pt_e2e_mplife_0002";

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

function repo(name: string, extra: Partial<GatewayMarketplaceRepo> = {}): GatewayMarketplaceRepo {
  return {
    name,
    description: `The ${name} repo`,
    defaultBranch: "main",
    tags: ["v0.1.0"],
    gitUrl: gateway.gitUrl("marketplace", name),
    website: "https://example.com/" + name,
    topics: ["kb"],
    archived: false,
    ...extra,
  };
}

/** The requests the gateway saw that are not the stored-token handshake, as `METHOD path`. */
function seen(): string[] {
  return gateway.requests.filter((r) => r.path.startsWith("/api/v1/registry")).map((r) => `${r.method} ${r.path}`);
}

function writes(): string[] {
  return seen().filter((s) => !s.startsWith("GET "));
}

function patchBodies(): unknown[] {
  return gateway.requests.filter((r) => r.method === "PATCH").map((r) => JSON.parse(String(r.body)));
}

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-cli-mplife-"));
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

beforeEach(() => {
  gateway.repos = [repo("kb"), repo("other", { archived: true, description: "Old one" })];
  gateway.emptyRepos.clear();
  gateway.tombstones.clear();
  gateway.historyManager = true;
  gateway.requests.length = 0;
});

// ---- list ---------------------------------------------------------------------------------------------------

test("list: shows which repositories are archived, and --json carries the flag", async () => {
  const r = await b6p(["marketplace", "list"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /NAME\s+BRANCH\s+TAGS\s+ARCHIVED\s+DESCRIPTION/);
  assert.match(r.stdout, /other\s+main\s+v0\.1\.0\s+archived\s+Old one/);
  assert.match(r.stdout, /kb\s+main\s+v0\.1\.0\s+The kb repo/);
  const j = JSON.parse((await b6p(["--json", "marketplace", "list"])).stdout);
  assert.deepEqual(
    j.repos.map((x: GatewayMarketplaceRepo) => [x.name, x.archived]),
    [
      ["kb", false],
      ["other", true],
    ]
  );
});

// ---- get ----------------------------------------------------------------------------------------------------

test("get: shows the repository's details", async () => {
  const r = await b6p(["marketplace", "get", "kb"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /name:\s+kb/);
  assert.match(r.stdout, /description:\s+The kb repo/);
  assert.match(r.stdout, /website:\s+https:\/\/example\.com\/kb/);
  assert.match(r.stdout, /topics:\s+kb/);
  assert.match(r.stdout, /archived:\s+no/);
  assert.match(r.stdout, /default branch:\s+main/);
  assert.match(r.stdout, /tags:\s+v0\.1\.0/);
  assert.match(r.stdout, new RegExp(`clone URL:\\s+${gateway.gitUrl("marketplace", "kb").replace(/[.]/g, "\\.")}`));
});

test("get --json: the repo", async () => {
  const j = JSON.parse((await b6p(["--json", "marketplace", "get", "other"])).stdout);
  assert.equal(j.repo.name, "other");
  assert.equal(j.repo.archived, true);
});

test("get: finds an empty repository that list does not show", async () => {
  assert.equal((await b6p(["marketplace", "create", "fresh"])).code, 0);
  assert.doesNotMatch((await b6p(["marketplace", "list"])).stdout, /fresh/);
  const r = await b6p(["marketplace", "get", "fresh"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /name:\s+fresh/);
  assert.match(r.stdout, /description:\s+\(none\)/);
  assert.match(r.stdout, /tags:\s+\(none\)/);
});

test("get: a name no repository holds is not found, with the way out", async () => {
  const r = await b6p(["marketplace", "get", "nope"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /No marketplace repository has exactly that name/);
  assert.match(r.stderr, /b6p marketplace list/);
});

// ---- edit ---------------------------------------------------------------------------------------------------

test("edit: sends only the options given", async () => {
  const one = await b6p(["marketplace", "edit", "kb", "--description", "Knowledge base"]);
  assert.equal(one.code, 0, one.stderr);
  assert.match(one.stdout, /Updated marketplace repository kb/);
  assert.match(one.stdout, /description:\s+Knowledge base/);
  const two = await b6p([
    "marketplace",
    "edit",
    "kb",
    "--website",
    "https://bluestep.net/kb",
    "--topic",
    "a",
    "--topic",
    "b",
  ]);
  assert.equal(two.code, 0, two.stderr);
  assert.deepEqual(patchBodies(), [
    { description: "Knowledge base" },
    { website: "https://bluestep.net/kb", topics: ["a", "b"] },
  ]);
  assert.match(two.stdout, /topics:\s+a, b/);
});

test("edit: an empty --description or --website clears it, and --clear-topics clears the topics", async () => {
  const r = await b6p(["marketplace", "edit", "kb", "--description", "", "--website", "", "--clear-topics"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patchBodies(), [{ description: "", website: "", topics: [] }]);
  assert.match(r.stdout, /description:\s+\(none\)/);
  assert.match(r.stdout, /website:\s+\(none\)/);
  assert.match(r.stdout, /topics:\s+\(none\)/);
});

test("edit --json: the repo", async () => {
  const j = JSON.parse((await b6p(["--json", "marketplace", "edit", "kb", "--description", "X"])).stdout);
  assert.equal(j.repo.description, "X");
});

test("edit: no option is refused before anything is sent", async () => {
  const r = await b6p(["marketplace", "edit", "kb"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /Nothing to change/);
  assert.match(r.stderr, /--clear-topics/);
  assert.equal(seen().length, 0);
});

test("edit: --topic with --clear-topics is refused before anything is sent", async () => {
  const r = await b6p(["marketplace", "edit", "kb", "--topic", "a", "--clear-topics"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /contradict/);
  assert.equal(seen().length, 0);
});

test("edit: an archived repository says to unarchive it first", async () => {
  const r = await b6p(["marketplace", "edit", "other", "--description", "X"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /archived/);
  assert.match(r.stderr, /b6p marketplace unarchive other/);
});

test("edit: a missing repository is not found", async () => {
  const r = await b6p(["marketplace", "edit", "nope", "--description", "X"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No marketplace repository has exactly that name/);
});

test("edit: a bad value is refused before anything is sent", async () => {
  const r = await b6p(["marketplace", "edit", "kb", "--website", "ftp://x"]);
  assert.equal(r.code, 1);
  assert.equal(seen().length, 0);
});

test("edit: 403 not-permitted says only fleet super users may edit", async () => {
  gateway.failNext({ method: "PATCH", status: 403, body: { error: "not-permitted", message: "no" } });
  const r = await b6p(["marketplace", "edit", "kb", "--description", "X"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Only fleet super users may edit marketplace repositories/);
});

// ---- archive / unarchive -----------------------------------------------------------------------------------

test("archive and unarchive: say what changed and what it means", async () => {
  const a = await b6p(["marketplace", "archive", "kb"]);
  assert.equal(a.code, 0, a.stderr);
  assert.match(a.stdout, /Archived marketplace repository kb/);
  assert.match(a.stdout, /cloned and fetched/);
  assert.match(a.stdout, /b6p marketplace unarchive kb/);
  assert.equal(gateway.repos.find((r) => r.name === "kb")?.archived, true);

  const u = await b6p(["marketplace", "unarchive", "kb"]);
  assert.equal(u.code, 0, u.stderr);
  assert.match(u.stdout, /Unarchived marketplace repository kb/);
  assert.equal(gateway.repos.find((r) => r.name === "kb")?.archived, false);
});

test("archive and unarchive --json: the repo", async () => {
  const a = JSON.parse((await b6p(["--json", "marketplace", "archive", "kb"])).stdout);
  assert.equal(a.repo.archived, true);
  const u = JSON.parse((await b6p(["--json", "marketplace", "unarchive", "kb"])).stdout);
  assert.equal(u.repo.archived, false);
});

test("archive: archiving an archived repository is not an error", async () => {
  assert.equal((await b6p(["marketplace", "archive", "other"])).code, 0);
});

test("archive and unarchive: a missing repository is not found", async () => {
  for (const verb of ["archive", "unarchive"]) {
    const r = await b6p(["marketplace", verb, "nope"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /No marketplace repository has exactly that name/);
  }
});

test("archive: 409 rewrite-in-progress says to try again shortly", async () => {
  gateway.failNext({ method: "POST", status: 409, body: { error: "rewrite-in-progress", message: "busy" } });
  const r = await b6p(["marketplace", "archive", "kb"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /try again shortly/);
});

test("unarchive: a token without registry:push is told which scope to mint", async () => {
  await useToken(NO_PUSH);
  try {
    const r = await b6p(["marketplace", "unarchive", "other"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Mint a token with `registry:push`/);
  } finally {
    await useToken(SUPER);
  }
});

// ---- rename -------------------------------------------------------------------------------------------------

test("rename: prints the new clone URL, the redirect and how to update a remote", async () => {
  const r = await b6p(["marketplace", "rename", "kb", "kb-core"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Renamed marketplace repository kb to kb-core/);
  const url = gateway.gitUrl("marketplace", "kb-core");
  assert.ok(r.stdout.includes(`Clone URL: ${url}`), r.stdout);
  assert.match(r.stdout, /Existing clones keep working/);
  assert.ok(r.stdout.includes(`git remote set-url origin ${url}`), r.stdout);
});

test("rename --json: the repo and the previous name", async () => {
  const j = JSON.parse((await b6p(["--json", "marketplace", "rename", "kb", "kb-core"])).stdout);
  assert.equal(j.repo.name, "kb-core");
  assert.equal(j.previousName, "kb");
});

test("rename: the same name, or a bad one, is refused before anything is sent", async () => {
  assert.equal((await b6p(["marketplace", "rename", "kb", "kb"])).code, 1);
  assert.equal((await b6p(["marketplace", "rename", "kb", "Bad Name"])).code, 1);
  assert.equal(seen().length, 0);
});

test("rename: a taken name says to choose another", async () => {
  const r = await b6p(["marketplace", "rename", "kb", "other"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /already holds the new name/);
  assert.match(r.stderr, /Choose another name/);
});

test("rename: an archived repository says to unarchive it first", async () => {
  const r = await b6p(["marketplace", "rename", "other", "newer"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /b6p marketplace unarchive other/);
});

test("rename: a missing repository is not found", async () => {
  const r = await b6p(["marketplace", "rename", "nope", "newer"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No marketplace repository has exactly that name/);
});

// ---- delete -------------------------------------------------------------------------------------------------

test("delete: with no terminal and no --yes it refuses and sends nothing", async () => {
  const r = await b6p(["marketplace", "delete", "kb"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /nothing was deleted/);
  assert.match(r.stderr, /Pass --yes/);
  assert.equal(seen().length, 0);
  assert.ok(gateway.repos.some((x) => x.name === "kb"));
});

test("delete --yes: prints the tombstone name and that purge destroys it", async () => {
  const r = await b6p(["--yes", "marketplace", "delete", "kb"]);
  assert.equal(r.code, 0, r.stderr);
  const [tombstone] = [...gateway.tombstones.keys()];
  assert.match(tombstone, /^_deleted-\d+-kb$/);
  assert.match(r.stdout, /Deleted marketplace repository kb/);
  assert.ok(r.stdout.includes(`archived tombstone ${tombstone}`), r.stdout);
  assert.match(r.stdout, /nothing was destroyed/);
  assert.ok(r.stdout.includes(`b6p marketplace purge ${tombstone}`), r.stdout);
  assert.match(r.stdout, /irreversible/);
  assert.ok(!gateway.repos.some((x) => x.name === "kb"));
});

test("delete --yes --json: the name and its tombstone", async () => {
  const j = JSON.parse((await b6p(["--yes", "--json", "marketplace", "delete", "kb"])).stdout);
  assert.equal(j.name, "kb");
  assert.match(j.tombstone, /^_deleted-\d+-kb$/);
});

test("delete: typing the name back confirms; anything else cancels", async () => {
  const wrong = await b6p(["marketplace", "delete", "kb"], "nope\n");
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /Cancelled: nothing was deleted/);
  assert.equal(seen().length, 0);

  const right = await b6p(["marketplace", "delete", "kb"], "kb\n");
  assert.equal(right.code, 0, right.stderr);
  assert.match(right.stdout, /Deleted marketplace repository kb/);
});

test("delete: a missing repository is not found", async () => {
  const r = await b6p(["--yes", "marketplace", "delete", "nope"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No marketplace repository has exactly that name/);
});

test("delete: 403 not-permitted says only fleet super users may delete", async () => {
  gateway.failNext({ method: "DELETE", status: 403, body: { error: "not-permitted", message: "no" } });
  const r = await b6p(["--yes", "marketplace", "delete", "kb"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Only fleet super users may delete marketplace repositories/);
});

test("delete: 409 repo-exists (the tombstone's name is held) says nothing was deleted", async () => {
  gateway.failNext({ method: "DELETE", status: 409, body: { error: "repo-exists", message: "held" } });
  const r = await b6p(["--yes", "marketplace", "delete", "kb"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /tombstone name, so nothing was deleted/);
});

// ---- tombstones ---------------------------------------------------------------------------------------------

test("tombstones: none", async () => {
  const r = await b6p(["marketplace", "tombstones"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /No deleted marketplace repositories/);
});

test("tombstones: lists tombstone, original name, id and archived, and --json", async () => {
  await b6p(["--yes", "marketplace", "delete", "kb"]);
  const [tombstone] = [...gateway.tombstones.keys()];
  const r = await b6p(["marketplace", "tombstones"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /TOMBSTONE\s+NAME\s+ID\s+ARCHIVED/);
  assert.match(r.stdout, new RegExp(`${tombstone}\\s+kb\\s+\\d+\\s+yes`));
  const j = JSON.parse((await b6p(["--json", "marketplace", "tombstones"])).stdout);
  assert.equal(j.tombstones[0].tombstone, tombstone);
  assert.equal(j.tombstones[0].deletedName, "kb");
  assert.equal(j.tombstones[0].archived, true);
});

test("tombstones: a token without registry:push is told which scope to mint", async () => {
  await useToken(NO_PUSH);
  try {
    const r = await b6p(["marketplace", "tombstones"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Mint a token with `registry:push`/);
  } finally {
    await useToken(SUPER);
  }
});

// ---- purge --------------------------------------------------------------------------------------------------

async function tombstoneOfKb(): Promise<string> {
  assert.equal((await b6p(["--yes", "marketplace", "delete", "kb"])).code, 0);
  gateway.requests.length = 0;
  return [...gateway.tombstones.keys()][0];
}

test("purge: with no terminal and no flag it refuses and sends nothing", async () => {
  const t = await tombstoneOfKb();
  const r = await b6p(["marketplace", "purge", t]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /nothing was purged/);
  assert.match(r.stderr, /--confirm-purge/);
  assert.match(r.stderr, /no undo/);
  assert.equal(seen().length, 0);
  assert.ok(gateway.tombstones.has(t));
});

test("purge: --yes alone never purges", async () => {
  const t = await tombstoneOfKb();
  const r = await b6p(["--yes", "marketplace", "purge", t]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--yes alone never does this/);
  assert.match(r.stderr, /--confirm-purge/);
  assert.equal(seen().length, 0);
});

test("purge --confirm-purge: destroys it and says so; --json names it", async () => {
  const t = await tombstoneOfKb();
  const r = await b6p(["marketplace", "purge", t, "--confirm-purge"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Purged ${t}`));
  assert.match(r.stdout, /gone for good/);
  assert.equal(gateway.tombstones.size, 0);

  const t2 = await tombstoneOfKb2();
  const j = JSON.parse((await b6p(["--json", "marketplace", "purge", t2, "--confirm-purge"])).stdout);
  assert.equal(j.purged, t2);
});

async function tombstoneOfKb2(): Promise<string> {
  gateway.repos.push(repo("again"));
  assert.equal((await b6p(["--yes", "marketplace", "delete", "again"])).code, 0);
  return [...gateway.tombstones.keys()][0];
}

test("purge: typing the tombstone name back confirms; anything else cancels", async () => {
  const t = await tombstoneOfKb();
  const wrong = await b6p(["marketplace", "purge", t], "kb\n");
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /Cancelled: nothing was purged/);
  assert.equal(seen().length, 0);
  const right = await b6p(["marketplace", "purge", t], `${t}\n`);
  assert.equal(right.code, 0, right.stderr);
  assert.equal(gateway.tombstones.size, 0);
});

test("purge: without the history-manager grant says what is needed", async () => {
  const t = await tombstoneOfKb();
  gateway.historyManager = false;
  const r = await b6p(["marketplace", "purge", t, "--confirm-purge"]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /history-manager/);
  assert.match(r.stderr, /registry:push/);
  assert.match(r.stderr, /fleet super/);
  assert.match(r.stderr, /nothing was purged/i);
  assert.ok(gateway.tombstones.has(t));

  const j = await b6p(["--json", "marketplace", "purge", t, "--confirm-purge"]);
  assert.equal(JSON.parse(j.stdout).code, "not-permitted");
});

test("purge: a tombstone that is not archived says nothing was purged", async () => {
  const t = await tombstoneOfKb();
  const entry = gateway.tombstones.get(t);
  assert.ok(entry);
  gateway.tombstones.set(t, { ...entry, archived: false });
  const r = await b6p(["marketplace", "purge", t, "--confirm-purge"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not archived/);
  assert.match(r.stderr, /Nothing was purged/);
  assert.match(r.stderr, /b6p marketplace tombstones/);
});

test("purge: an unknown tombstone is not found and points at the tombstone list", async () => {
  const r = await b6p(["marketplace", "purge", "_deleted-999-ghost", "--confirm-purge"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No tombstone has exactly that name/);
  assert.match(r.stderr, /b6p marketplace tombstones/);
});

test("purge: a name that is not a tombstone is refused before anything is sent", async () => {
  const r = await b6p(["marketplace", "purge", "kb", "--confirm-purge"]);
  assert.equal(r.code, 1);
  assert.equal(seen().length, 0);
});

test("the new verbs are in the marketplace help", async () => {
  const r = await b6p(["marketplace", "--help"]);
  for (const verb of ["get", "edit", "archive", "unarchive", "rename", "delete", "tombstones", "purge"]) {
    assert.match(r.stdout, new RegExp(`^\\s+${verb}\\b`, "m"), verb);
  }
});
