// Spec for b6p as git's credential helper: `b6p auth git-credential` (run by git), `b6p auth
// setup-git`, the git line of `b6p auth status`, the offer after `b6p auth set` and the hints after
// a pull. Behaviour is core's (`core.gitCredential`); this pins the wiring and the wording.
//
// Every run that reaches git uses a throwaway HOME, XDG_CONFIG_HOME and GIT_CONFIG_GLOBAL, and
// GIT_CONFIG_NOSYSTEM=1 (see isolatedEnv), so the real user's git config and ~/.b6p are never read
// or written.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { PassThrough, Readable } from "node:stream";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  Err,
  type GitCredentialHostStatus,
  type GitCredentialSetupResult,
  type GitCredentialSetupStatus,
} from "@bluestep-systems/b6p-core";
import { answerGitCredential } from "../src/gitCredentialHelper";
import {
  cloneHint,
  describeGitSetupError,
  describeRemoval,
  describeSetup,
  gitStatusLine,
  keptResetLine,
  statusHint,
} from "../src/gitSetup";
import { OFFER_HINT, OFFER_QUESTION, hintAfterPull, offerGitSetup, type GitSetupOffer } from "../src/gitSetupRun";
import { CliPrompt } from "../src/providers/CliPrompt";
import { isolatedEnv } from "./isolatedEnv";

const CLI = path.resolve(__dirname, "../dist/cli.js");
const TOKEN = "b6pt_git_credential_test_0001";
const GATEWAY = "gateway.bluestep.net";
const posixOnly = { skip: process.platform === "win32" ? "uses POSIX shell stand-ins on PATH" : false };

// ── Unit: the helper's I/O ────────────────────────────────────────────

function io(answer: (action: string, input: string) => Promise<string>, input = "protocol=https\nhost=h\n\n") {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      input: Readable.from([Buffer.from(input)]),
      writeAnswer: (t: string) => out.push(t),
      writeDiagnostic: (t: string) => err.push(t),
      answer,
    },
  };
}

test("git-credential writes exactly core's answer, and is handed git's action and request", async () => {
  const seen: [string, string][] = [];
  const answerText = `username=b6p\npassword=${TOKEN}\n`;
  const run = io(async (action, input) => {
    seen.push([action, input]);
    return answerText;
  });
  assert.equal(await answerGitCredential("get", run.io), 0);
  assert.deepEqual(run.out, [answerText]);
  assert.deepEqual(run.err, []);
  assert.deepEqual(seen, [["get", "protocol=https\nhost=h\n\n"]]);
});

test("git-credential exits 0 with nothing on stdout when answering throws, and never prints the error", async () => {
  const run = io(async () => {
    throw new Error(`boom ${TOKEN}`);
  });
  assert.equal(await answerGitCredential("get", run.io), 0);
  assert.deepEqual(run.out, []);
  assert.equal(run.err.length, 1);
  assert.doesNotMatch(run.err.join(""), new RegExp(TOKEN));
  assert.doesNotMatch(run.err.join(""), /boom/);
});

test("git-credential with no action asks core with an empty action and writes nothing for an empty answer", async () => {
  let asked: string | undefined;
  const run = io(async (action) => {
    asked = action;
    return "";
  });
  assert.equal(await answerGitCredential(undefined, run.io), 0);
  assert.equal(asked, "");
  assert.deepEqual(run.out, []);
});

// ── Unit: wording ─────────────────────────────────────────────────────

function host(over: Partial<GitCredentialHostStatus> = {}): GitCredentialHostStatus {
  return { host: GATEWAY, source: "gateway", configured: true, alsoAsked: [], others: [], ...over };
}

function setupResult(over: Partial<GitCredentialSetupResult> = {}): GitCredentialSetupResult {
  return {
    added: [GATEWAY],
    alreadyConfigured: [],
    hosts: [host()],
    otherHelpers: [],
    keptResets: [],
    scope: "global",
    ...over,
  };
}

function status(over: Partial<GitCredentialSetupStatus> = {}): GitCredentialSetupStatus {
  return { hosts: [host({ configured: false })], configured: false, otherHelpers: [], scope: "global", ...over };
}

test("setup output names the hosts and the file written, and that a draft push still needs b6p script push", () => {
  const lines = describeSetup(setupResult(), "/home/u/.gitconfig");
  assert.match(lines.info[0], /Set git to use b6p's token for gateway\.bluestep\.net, in \/home\/u\/\.gitconfig\./);
  assert.ok(lines.info.some((l) => /does not build or publish it; that still takes `b6p script push`/.test(l)));
  assert.deepEqual(lines.warn, []);
});

test("setup output when everything was set up already says nothing changed", () => {
  const lines = describeSetup(setupResult({ added: [], alreadyConfigured: [GATEWAY] }), null);
  assert.match(lines.info[0], /git already uses b6p's token for gateway\.bluestep\.net; nothing changed\./);
});

test("setup output warns about a host another helper still answers, naming the entry and what to do", () => {
  const blocked = host({
    host: "u1.bluestep.net",
    source: "script-pull",
    configured: false,
    alsoAsked: ["cache"],
    others: [{ key: "credential.https://u1.bluestep.net.helper", value: "cache", file: "/repo/.git/config" }],
  });
  const lines = describeSetup(setupResult({ added: ["u1.bluestep.net"], hosts: [host(), blocked] }), "/g");
  assert.equal(lines.warn.length, 1);
  assert.match(lines.warn[0], /u1\.bluestep\.net is not fully set up: git also asks `cache`/);
  assert.match(lines.warn[0], /`credential\.https:\/\/u1\.bluestep\.net\.helper = cache` in \/repo\/\.git\/config/);
  assert.match(lines.warn[0], /move it before b6p's \[credential "https:\/\/u1\.bluestep\.net"\] section, or remove it/);
});

test("kept resets are reported, with why, on setup and on removal", () => {
  const shared = { url: `https://${GATEWAY}`, file: "/g", reason: "shared-key" as const };
  const unconfirmed = { url: `https://${GATEWAY}`, file: "/g", reason: "unconfirmed" as const };
  assert.match(keptResetLine(shared), /cannot remove only b6p's/);
  assert.match(keptResetLine(unconfirmed), /interrupted/);
  assert.ok(describeSetup(setupResult({ keptResets: [shared] }), "/g").info.includes(keptResetLine(shared)));

  const removal = describeRemoval({ removed: [`https://${GATEWAY}`], keptResets: [unconfirmed] });
  assert.deepEqual(removal.info, [
    `Removed b6p's git credential entries for https://${GATEWAY}.`,
    keptResetLine(unconfirmed),
  ]);
  assert.deepEqual(describeRemoval({ removed: [], keptResets: [] }).info, [
    "b6p had no git credential entries to remove.",
  ]);
});

test("auth status's git line: set up, not set up (and why), no host, and git too old", () => {
  assert.equal(
    gitStatusLine(status({ hosts: [host()], configured: true })),
    "git: set up for gateway.bluestep.net."
  );
  assert.equal(gitStatusLine(status()), "git: not set up for gateway.bluestep.net; run `b6p auth setup-git`.");
  assert.equal(
    gitStatusLine(status({ hosts: [host({ configured: false, alsoAsked: ["store"] })] })),
    "git: not set up for gateway.bluestep.net (git also asks `store`); run `b6p auth setup-git`."
  );
  assert.match(gitStatusLine(status({ hosts: [] })), /^git: no host for b6p to answer yet/);
  assert.equal(
    gitStatusLine({ error: "git 2.20.0 is older than 2.27.0, which this needs." }),
    "git: cannot check (git 2.20.0 is older than 2.27.0, which this needs.)"
  );
});

test("git floor errors say what to do", () => {
  assert.equal(
    describeGitSetupError("git 2.30.0 is older than 2.42.0, which this needs."),
    "git 2.30.0 is older than 2.42.0, which this needs. Update git, then run the command again."
  );
  assert.match(describeGitSetupError("git could not be run; it may not be installed."), /Install git/);
});

test("pull hints: only when the clone's host is not set up; none off the allowlist or when set up", () => {
  assert.equal(cloneHint(null), null);
  assert.equal(cloneHint(host()), null);
  assert.equal(
    cloneHint(host({ configured: false })),
    "To let plain git pull and git push here use your b6p token, run `b6p auth setup-git`."
  );
  assert.match(cloneHint(host({ configured: false, alsoAsked: ["store"] })) ?? "", /git here also asks `store`/);
  assert.equal(statusHint(status({ hosts: [host()], configured: true })), null);
  assert.match(statusHint(status()) ?? "", /for gateway\.bluestep\.net, run `b6p auth setup-git`\./);
});

test("a pull's hint never fails the pull: an error is a debug line only", async () => {
  const info: string[] = [];
  const debug: string[] = [];
  const report = { info: (m: string) => info.push(m), debug: (m: string) => debug.push(m) };
  await hintAfterPull(report, async () => {
    throw new Err.GitCredentialSetupError("git could not be run; it may not be installed.", null);
  });
  assert.deepEqual(info, []);
  assert.equal(debug.length, 1);
  await hintAfterPull(report, async () => "the hint");
  assert.deepEqual(info, ["the hint"]);
  await hintAfterPull(report, async () => null);
  assert.deepEqual(info, ["the hint"]);
});

// ── Unit: the offer after `auth set` ──────────────────────────────────

function offer(over: Partial<GitSetupOffer> & { answer?: string } = {}) {
  const calls = { confirm: [] as string[], info: [] as string[], setup: 0 };
  const o: GitSetupOffer = {
    interactive: true,
    status: async () => status(),
    confirm: async (message) => {
      calls.confirm.push(message);
      return over.answer;
    },
    info: (m) => calls.info.push(m),
    setup: async () => {
      calls.setup += 1;
    },
    ...over,
  };
  return { o, calls };
}

test("auth set in a terminal asks, and sets git up on yes", async () => {
  const { o, calls } = offer({ answer: "Yes" });
  await offerGitSetup(o);
  assert.deepEqual(calls.confirm, [OFFER_QUESTION]);
  assert.equal(calls.setup, 1);
});

test("auth set in a terminal: no leaves git alone", async () => {
  const { o, calls } = offer({ answer: "No" });
  await offerGitSetup(o);
  assert.equal(calls.setup, 0);
});

test("auth set's question defaults to yes (Enter on its own)", async () => {
  const input = new PassThrough();
  const prompt = new CliPrompt({ input, output: new PassThrough() });
  let setups = 0;
  const pending = offerGitSetup({
    interactive: true,
    status: async () => status(),
    confirm: (m, opts) => prompt.confirm(m, opts),
    info: () => {},
    setup: async () => {
      setups += 1;
    },
  });
  input.write("\n");
  await pending;
  prompt.close();
  assert.equal(setups, 1);
});

test("auth set without a terminal (or under --yes) prints a hint and never asks", async () => {
  const { o, calls } = offer({ interactive: false, answer: "Yes" });
  await offerGitSetup(o);
  assert.deepEqual(calls.confirm, []);
  assert.deepEqual(calls.info, [OFFER_HINT]);
  assert.equal(calls.setup, 0);
});

test("auth set says nothing when git is set up, there is no host, or git cannot be checked", async () => {
  for (const s of [
    async () => status({ hosts: [host()], configured: true }),
    async () => status({ hosts: [] }),
    async (): Promise<GitCredentialSetupStatus> => {
      throw new Err.GitCredentialSetupError("git 2.20.0 is older than 2.27.0, which this needs.", null);
    },
  ]) {
    const { o, calls } = offer({ status: s, answer: "Yes" });
    await offerGitSetup(o);
    assert.deepEqual(calls, { confirm: [], info: [], setup: 0 });
  }
});

// ── End to end: the built CLI and real git ────────────────────────────

let home: string;
let bin: string;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** The built CLI with a throwaway home, and `bin` (holding a stand-in `b6p`) first on PATH. */
function b6p(args: string[], stdin = "", opts: { cwd?: string; path?: string } = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: opts.cwd ?? home,
      env: isolatedEnv(home, { PATH: opts.path ?? `${bin}${path.delimiter}${process.env.PATH ?? ""}` }),
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

function git(args: string[], input = "", cwd = home): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    env: isolatedEnv(home, { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, GIT_TERMINAL_PROMPT: "0" }),
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const GET = `protocol=https\nhost=${GATEWAY}\n\n`;

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-cli-gitcred-"));
  bin = path.join(home, "bin");
  fs.mkdirSync(bin);
  // The helper setup-git writes is `!b6p auth git-credential`: point `b6p` at this build.
  fs.writeFileSync(
    path.join(bin, "b6p"),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@"\n`,
    { mode: 0o755 }
  );
  const set = await b6p(["auth", "set"], `${TOKEN}\n`);
  assert.equal(set.code, 0, set.stderr);
  // Not a terminal: the one-line hint, no question.
  assert.match(set.stderr, /To let plain git pull and git push use this token, run `b6p auth setup-git`\./);
  assert.doesNotMatch(set.stderr, /\[Yes\]/);
});

after(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

test("e2e: git-credential get answers only the token's two lines on stdout, exit 0, nothing on stderr", async () => {
  const r = await b6p(["auth", "git-credential", "get"], GET);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, `username=b6p\npassword=${TOKEN}\n`);
  assert.equal(r.stderr, "");
});

test("e2e: git-credential answers nothing, exit 0, for another host, store, erase, an unknown action or none", async () => {
  for (const [args, input] of [
    [["get"], "protocol=https\nhost=gateway.bluestep.net.evil.example\n\n"],
    [["get"], `protocol=http\nhost=${GATEWAY}\n\n`],
    [["store"], `${GET.trim()}\nusername=b6p\npassword=${TOKEN}\n\n`],
    [["erase"], `${GET.trim()}\nusername=b6p\npassword=${TOKEN}\n\n`],
    [["bogus"], GET],
    [[], GET],
  ] as [string[], string][]) {
    const r = await b6p(["auth", "git-credential", ...args], input);
    assert.equal(r.code, 0, `${args.join(" ")}: ${r.stderr}`);
    assert.equal(r.stdout, "", args.join(" "));
    assert.doesNotMatch(r.stderr, new RegExp(TOKEN));
  }
  // Flags git never passes change nothing: no JSON body, no failure.
  const flagged = await b6p(["--json", "auth", "git-credential", "get", "--extra"], GET);
  assert.equal(flagged.code, 0, flagged.stderr);
  assert.equal(flagged.stdout, `username=b6p\npassword=${TOKEN}\n`);
  // erase never signs b6p out.
  assert.equal((await b6p(["auth", "git-credential", "get"], GET)).stdout, `username=b6p\npassword=${TOKEN}\n`);
});

test("e2e: git-credential still exits 0 with empty stdout when b6p's state cannot be read", async () => {
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), "b6p-cli-gitcred-broken-"));
  try {
    fs.writeFileSync(path.join(broken, ".b6p"), "not a directory");
    const child = spawnSync(process.execPath, [CLI, "auth", "git-credential", "get"], {
      input: GET,
      encoding: "utf8",
      env: isolatedEnv(broken),
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "");
  } finally {
    fs.rmSync(broken, { recursive: true, force: true });
  }
});

test("e2e: setup-git, status, plain git, removal", posixOnly, async () => {
  const gitconfig = path.join(home, ".gitconfig");
  fs.writeFileSync(gitconfig, "[credential]\n\thelper = store\n");

  const before = await b6p(["auth", "status"]);
  assert.equal(before.code, 0);
  assert.match(before.stderr, /git: not set up for gateway\.bluestep\.net \(git also asks `store`\)/);

  const setup = await b6p(["auth", "setup-git"]);
  assert.equal(setup.code, 0, setup.stderr);
  assert.match(setup.stderr, new RegExp(`Set git to use b6p's token for gateway\\.bluestep\\.net, in .*\\.gitconfig\\.`));
  assert.equal(setup.stdout, "");
  assert.match(fs.readFileSync(gitconfig, "utf8"), /\[credential "https:\/\/gateway\.bluestep\.net"\]\n\thelper =\n/);

  const again = await b6p(["auth", "setup-git"]);
  assert.match(again.stderr, /git already uses b6p's token for gateway\.bluestep\.net; nothing changed\./);

  const json = await b6p(["--json", "auth", "status"]);
  assert.equal(json.code, 0);
  const body = JSON.parse(json.stdout) as { authenticated: boolean; git: { configured: boolean; error: null } };
  assert.equal(body.authenticated, true);
  assert.equal(body.git.configured, true);
  assert.equal(body.git.error, null);

  // git itself, through the stand-in `b6p` on PATH.
  const fill = git(["credential", "fill"], GET);
  assert.equal(fill.code, 0, fill.stderr);
  assert.match(fill.stdout, new RegExp(`username=b6p\npassword=${TOKEN}\n`));
  assert.doesNotMatch(fill.stderr, new RegExp(TOKEN));

  const removal = await b6p(["auth", "setup-git", "--remove"]);
  assert.equal(removal.code, 0, removal.stderr);
  assert.match(removal.stderr, /Removed b6p's git credential entries for https:\/\/gateway\.bluestep\.net\./);
  assert.equal(fs.readFileSync(gitconfig, "utf8"), "[credential]\n\thelper = store\n");
  assert.match((await b6p(["auth", "setup-git", "--remove"])).stderr, /b6p had no git credential entries to remove/);
});

test("e2e: setup-git in a clone whose own config asks another helper warns, naming the entry", posixOnly, async () => {
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo, { recursive: true });
  assert.equal(git(["init", "-q"], "", repo).code, 0);
  assert.equal(git(["config", `credential.https://${GATEWAY}.helper`, "cache"], "", repo).code, 0);
  try {
    const setup = await b6p(["auth", "setup-git"], "", { cwd: repo });
    assert.equal(setup.code, 0, setup.stderr);
    assert.match(setup.stderr, /WARNING: gateway\.bluestep\.net is not fully set up: git also asks `cache`/);
    assert.match(setup.stderr, /in .*repo\/\.git\/config/);
  } finally {
    await b6p(["auth", "setup-git", "--remove"]);
  }
});

test("e2e: with a git older than the floor, setup-git fails saying so and status reports it", posixOnly, async () => {
  const oldBin = path.join(home, "old-git-bin");
  fs.mkdirSync(oldBin, { recursive: true });
  fs.writeFileSync(path.join(oldBin, "git"), "#!/bin/sh\necho 'git version 2.20.0'\n", { mode: 0o755 });
  const p = `${oldBin}${path.delimiter}${process.env.PATH ?? ""}`;

  const setup = await b6p(["auth", "setup-git"], "", { path: p });
  assert.equal(setup.code, 1);
  assert.match(setup.stderr, /git 2\.20\.0 is older than 2\.27\.0, which this needs\. Update git, then run the command again\./);

  const s = await b6p(["auth", "status"], "", { path: p });
  assert.equal(s.code, 0, "a negative answer is a report, not a failure");
  assert.match(s.stderr, /git: cannot check \(git 2\.20\.0 is older than 2\.27\.0/);
});

test("e2e: auth set under --yes prints the hint, never the question", async () => {
  const r = await b6p(["--yes", "auth", "set"], `${TOKEN}\n`);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /run `b6p auth setup-git`/);
  assert.doesNotMatch(r.stderr, /Set up git to use this token/);
});
