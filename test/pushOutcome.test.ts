// The push verdict: exit code, one error line and --json body, all from pushProblem.
//
// Core 0.9 saves sources to draft/, asks the platform to compile (and, for a snapshot, publish), and
// reports `route`, `snapshotRefused`, `compile` and `publish`. Core says what happened; these tables
// pin what the CLI says to do about it and which outcomes read as failure.
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  Err,
  KNOWN_DRAFT_COMPILE_STATUSES,
  KNOWN_PUBLISH_REFUSAL_REASONS,
  type DraftCompileOutcome,
  type DraftCompileStatus,
  type PublishOutcome,
  type PushResult,
} from "@bluestep-systems/b6p-core";
import {
  SNAPSHOT_REFUSED_LINE,
  declinedPushJson,
  canonicalPushArgs,
  compileDetailLines,
  deleteCommand,
  detectShellDialect,
  formatDiagnostic,
  overwriteCommand,
  pushDetailLines,
  pushErrorOutcome,
  pushExitCode,
  pushProblem,
  routeVerboseLines,
  shellQuote,
  toPushJson,
} from "../src/pushOutcome";

function compile(status: DraftCompileStatus, overrides: Partial<DraftCompileOutcome> = {}): DraftCompileOutcome {
  return {
    status,
    rawStatus: status,
    errors: 0,
    warnings: 0,
    written: 1,
    deleted: 0,
    diagnostics: [],
    diagnosticsOmitted: 0,
    ...overrides,
  };
}

function publish(overrides: Partial<PublishOutcome> = {}): PublishOutcome {
  return {
    published: true,
    written: 1,
    deleted: 0,
    errors: 0,
    warnings: 0,
    diagnostics: [],
    diagnosticsOmitted: 0,
    withheld: [],
    ...overrides,
  };
}

/** A clean plain push on the server route; each case overrides what it tests. */
function result(overrides: Partial<PushResult> = {}): PushResult {
  return {
    pushed: true,
    route: { mode: "server", reason: "at-or-above-floor", serverVersion: "26.11.16.00", required: "26.11.09.00" },
    snapshotRefused: null,
    compile: compile("COMPILED"),
    publish: null,
    historyRecorded: false,
    keptPlatformOnly: [],
    ...overrides,
  };
}

/** A clean snapshot push on the server route. */
function snapshotResult(overrides: Partial<PushResult> = {}): PushResult {
  return result({ publish: publish(), historyRecorded: true, ...overrides });
}

/** What core returns for a snapshot asked of a server without server-side compile. */
function refusedResult(reason: "too-old" | "unknown" | "floor-unset"): PushResult {
  return result({
    route: {
      mode: "draft-only",
      reason: reason === "too-old" ? "below-floor" : reason,
      serverVersion: null,
      required: null,
    },
    snapshotRefused: { reason, serverVersion: "26.10.01.00", required: "26.11.09.00" },
    compile: null,
  });
}

describe("pushExitCode", () => {
  it("is 0 for a clean plain push and a clean snapshot push", () => {
    assert.strictEqual(pushExitCode(result(), false), 0);
    assert.strictEqual(pushExitCode(snapshotResult(), true), 0);
  });

  it("is 0 when the user cancelled at the target-URL prompt (null)", () => {
    assert.strictEqual(pushExitCode(null, false), 0);
  });

  it("is 0 for a plain push on the draft-only route: sources saved is the whole contract there", () => {
    const draftOnly = result({
      route: { mode: "draft-only", reason: "below-floor", serverVersion: "26.10.01.00", required: "26.11.09.00" },
      compile: null,
    });
    assert.strictEqual(pushExitCode(draftOnly, false), 0);
    assert.strictEqual(pushProblem(draftOnly, false), null);
  });

  it("is 1 when nothing was uploaded (pushed: false, e.g. app.js missing or without code)", () => {
    assert.strictEqual(pushExitCode(result({ pushed: false, route: null, compile: null }), false), 1);
  });

  it("is 1 when the snapshot history entry was not recorded", () => {
    assert.strictEqual(pushExitCode(snapshotResult({ historyRecorded: false }), true), 1);
  });

  it("is 0 for a plain push: historyRecorded is false there and means nothing", () => {
    assert.strictEqual(pushExitCode(result({ historyRecorded: false }), false), 0);
  });

  it("is 0 when kept platform-only files are the only news", () => {
    assert.strictEqual(pushExitCode(result({ keptPlatformOnly: ["scripts/old.ts"] }), false), 0);
  });

  it("is 0 for COMPILED with errors on a plain push (sources and output saved, diagnostics printed)", () => {
    assert.strictEqual(pushExitCode(result({ compile: compile("COMPILED", { errors: 2 }) }), false), 0);
  });
});

describe("pushProblem: snapshotRefused (ruling 46)", () => {
  for (const reason of ["too-old", "unknown", "floor-unset"] as const) {
    it(`${reason}: the one error line is exactly "cannot snapshot, only push saves", exit 1`, () => {
      const r = refusedResult(reason);
      const problem = pushProblem(r, true);
      assert.strictEqual(problem?.kind, "SNAPSHOT_REFUSED");
      assert.strictEqual(problem?.message, "cannot snapshot, only push saves");
      assert.strictEqual(SNAPSHOT_REFUSED_LINE, "cannot snapshot, only push saves");
      assert.strictEqual(pushExitCode(r, true), 1);
    });

    it(`${reason}: --json carries the reason and both versions, verbose says them in words`, () => {
      const r = refusedResult(reason);
      const json = toPushJson(r, true);
      assert.deepStrictEqual(json.snapshotRefused, { reason, serverVersion: "26.10.01.00", required: "26.11.09.00" });
      assert.deepStrictEqual(json.error, { kind: "SNAPSHOT_REFUSED", message: "cannot snapshot, only push saves" });
      assert.strictEqual(json.pushed, true, "the draft was saved");
      const verbose = routeVerboseLines(r).join("\n");
      assert.match(
        verbose,
        new RegExp(`Snapshot refused: ${reason} \\(server version 26\\.10\\.01\\.00, required 26\\.11\\.09\\.00\\)`)
      );
      assert.match(verbose, /Push route: draft-only/);
    });
  }

  it("verbose names an unreadable version and an unset floor as such", () => {
    const r = result({
      route: { mode: "draft-only", reason: "floor-unset", serverVersion: null, required: null },
      snapshotRefused: { reason: "floor-unset", serverVersion: null, required: null },
      compile: null,
    });
    assert.match(routeVerboseLines(r).join("\n"), /server version unknown, required not set/);
  });
});

describe("pushProblem: compile status on the server route", () => {
  it("GATE_TRIPPED fails a plain push, says what is saved and what to do, lists the gate's problems", () => {
    const gateful = compile("GATE_TRIPPED", {
      gate: {
        tripped: true,
        withheld: ["scripts"],
        checked: 3,
        problemsOmitted: 4,
        problems: [
          {
            kind: "OUT_DIR",
            tsconfig: "draft/tsconfig.json",
            file: "scripts/app.ts",
            message: "outDir escapes",
            accepted: false,
          },
          { kind: "FINE", tsconfig: "draft/tsconfig.json", message: "accepted one", accepted: true },
        ],
      },
    });
    const r = result({ compile: gateful });
    const problem = pushProblem(r, false);
    assert.strictEqual(problem?.kind, "COMPILE_GATE_TRIPPED");
    assert.match(
      problem?.message ?? "",
      /save gate stopped the compile.*sources are saved.*output was not updated\. Fix/
    );
    assert.doesNotMatch(problem?.message ?? "", /nothing was published/, "a plain push publishes nothing anyway");
    assert.deepStrictEqual(problem?.details, [
      "  gate [OUT_DIR] draft/tsconfig.json scripts/app.ts: outDir escapes",
      "  ... 4 more gate problem(s) omitted",
      "  output withheld for: scripts",
    ]);
    assert.strictEqual(pushExitCode(r, false), 1);
  });

  it("EMIT_WITHHELD fails a plain push", () => {
    const r = result({ compile: compile("EMIT_WITHHELD", { errors: 1 }) });
    const problem = pushProblem(r, false);
    assert.strictEqual(problem?.kind, "COMPILE_EMIT_WITHHELD");
    assert.match(problem?.message ?? "", /withheld its compiled output.*noEmitOnError.*Fix the errors/);
    assert.strictEqual(pushExitCode(r, false), 1);
  });

  it("on a snapshot both also say that nothing was published", () => {
    for (const status of ["GATE_TRIPPED", "EMIT_WITHHELD"] as const) {
      const r = result({ compile: compile(status) });
      assert.match(pushProblem(r, true)?.message ?? "", /and nothing was published/);
      assert.strictEqual(pushExitCode(r, true), 1);
    }
  });

  const notBuilt: DraftCompileStatus[] = [
    "NOT_PERMITTED",
    "COMPILER_UNAVAILABLE",
    "WRITE_FAILED",
    "INPUT_INCOMPLETE",
    "BUSY",
    "OUTPUT_UPLOAD",
  ];
  for (const status of notBuilt) {
    it(`${status} fails: sources saved, output not updated, with a hint`, () => {
      const r = result({ compile: compile(status) });
      const problem = pushProblem(r, false);
      assert.strictEqual(problem?.kind, "COMPILE_NOT_BUILT");
      assert.ok(problem?.message.includes(`compile ended as ${status} (`), problem?.message);
      assert.match(problem?.message ?? "", /output was not updated\.$/);
      assert.strictEqual(pushExitCode(r, false), 1);
      assert.match(pushProblem(r, true)?.message ?? "", /not updated and nothing was published\.$/);
    });
  }

  it("UNKNOWN keeps the platform's own status text and asks for an update", () => {
    const r = result({ compile: compile("UNKNOWN", { rawStatus: "SHINY_NEW_STATUS" }) });
    const problem = pushProblem(r, false);
    assert.strictEqual(problem?.kind, "COMPILE_NOT_BUILT");
    assert.match(
      problem?.message ?? "",
      /ended as SHINY_NEW_STATUS \(status "SHINY_NEW_STATUS" is not one this b6p knows/
    );
    assert.strictEqual(pushExitCode(r, false), 1);
  });

  it("every status core knows is covered: builders pass, the rest fail, SKIPPED_GIT_MANAGED only on a snapshot", () => {
    const passing = ["COMPILED", "NOTHING_TO_COMPILE", "SKIPPED_EXTERNALLY_BUILT", "SKIPPED_GIT_MANAGED"];
    for (const status of KNOWN_DRAFT_COMPILE_STATUSES) {
      const plain = pushExitCode(result({ compile: compile(status) }), false);
      assert.strictEqual(plain, passing.includes(status) ? 0 : 1, `plain push, ${status}`);
    }
    // A snapshot publishes for exactly the statuses that build; git-managed has no publish.
    for (const status of ["COMPILED", "NOTHING_TO_COMPILE", "SKIPPED_EXTERNALLY_BUILT"] as const) {
      assert.strictEqual(pushExitCode(snapshotResult({ compile: compile(status) }), true), 0, `snapshot, ${status}`);
    }
    const gitManaged = result({ compile: compile("SKIPPED_GIT_MANAGED") });
    assert.strictEqual(pushExitCode(gitManaged, true), 1);
    assert.strictEqual(pushProblem(gitManaged, true)?.kind, "NOT_PUBLISHED");
    assert.match(pushProblem(gitManaged, true)?.message ?? "", /managed by git/);
  });

  it("a snapshot that published nothing, or whose publish says published: false, fails", () => {
    assert.strictEqual(pushProblem(result({ compile: compile("COMPILED") }), true)?.kind, "NOT_PUBLISHED");
    const r = snapshotResult({ publish: publish({ published: false }) });
    assert.strictEqual(pushProblem(r, true)?.kind, "NOT_PUBLISHED");
    assert.strictEqual(pushExitCode(r, true), 1);
  });

  it("a published snapshot with COMPILED errors still passes: the platform decided to publish", () => {
    const r = snapshotResult({ compile: compile("COMPILED", { errors: 2 }), publish: publish({ errors: 2 }) });
    assert.strictEqual(pushExitCode(r, true), 0);
  });
});

describe("pushProblem: other outcomes", () => {
  it("nothing pushed reads as a failure with the old advice", () => {
    const problem = pushProblem(result({ pushed: false }), false);
    assert.strictEqual(problem?.kind, "NOTHING_PUSHED");
    assert.match(problem?.message ?? "", /^Nothing was pushed/);
  });

  it("an unrecorded snapshot history entry says the IDE has no restore point", () => {
    const problem = pushProblem(snapshotResult({ historyRecorded: false }), true);
    assert.strictEqual(problem?.kind, "HISTORY_NOT_RECORDED");
    assert.match(problem?.message ?? "", /history entry was NOT recorded/);
  });
});

describe("diagnostic and detail lines", () => {
  it("formats a located diagnostic like tsc and an unlocated one with its origin", () => {
    assert.strictEqual(
      formatDiagnostic({
        origin: "tsc",
        severity: "error",
        code: 2322,
        file: "scripts/app.ts",
        line: 3,
        column: 7,
        message: "bad",
      }),
      "scripts/app.ts(3,7): error 2322: bad"
    );
    assert.strictEqual(
      formatDiagnostic({ origin: "tsc", severity: "warning", message: "careful" }),
      "[tsc] warning: careful"
    );
    assert.strictEqual(
      formatDiagnostic({ origin: "tsc", severity: "error", file: "a.ts", message: "no position" }),
      "a.ts: error: no position"
    );
  });

  it("shows the capped list and says how many were omitted", () => {
    const lines = compileDetailLines({
      diagnostics: [{ origin: "tsc", severity: "error", file: "a.ts", line: 1, column: 1, message: "x" }],
      diagnosticsOmitted: 12,
    });
    assert.deepStrictEqual(lines, ["  a.ts(1,1): error: x", "  ... 12 more diagnostic(s) omitted"]);
    assert.deepStrictEqual(compileDetailLines({ diagnostics: [], diagnosticsOmitted: 0 }), []);
  });

  it("pushDetailLines covers the compile and the publish, and nothing for a draft-only push", () => {
    const d = { origin: "tsc", severity: "error", message: "boom" };
    const r = snapshotResult({
      compile: compile("COMPILED", { diagnostics: [d] }),
      publish: publish({ diagnostics: [d], withheld: ["x"] }),
    });
    assert.deepStrictEqual(pushDetailLines(r), [
      "  [tsc] error: boom",
      "  [tsc] error: boom",
      "  output withheld for: x",
    ]);
    assert.deepStrictEqual(pushDetailLines(result({ compile: null })), []);
  });

  it("verbose lines name the route; a null route (draft folder missing) says nothing", () => {
    assert.match(
      routeVerboseLines(result()).join("\n"),
      /Push route: server \(at-or-above-floor; server version 26\.11\.16\.00, required 26\.11\.09\.00\)/
    );
    assert.deepStrictEqual(routeVerboseLines(result({ route: null })), []);
  });
});

describe("pushErrorOutcome: Err.PublishRefusedError", () => {
  const refusal = (reason: string, rawReason = reason, pub: PublishOutcome = publish({ published: false })) =>
    new Err.PublishRefusedError(
      `The platform refused to publish the snapshot (${rawReason}); the published script is unchanged.`,
      { reason: reason as never, rawReason, publish: pub }
    );

  for (const reason of KNOWN_PUBLISH_REFUSAL_REASONS) {
    it(`${reason}: one line with core's sentence, saved sources and a way on; --json names the reason`, () => {
      const out = pushErrorOutcome(refusal(reason), false);
      assert.ok(out, "mapped");
      assert.strictEqual(out.problem.kind, "PUBLISH_REFUSED");
      assert.ok(out.problem.message.startsWith(`The platform refused to publish the snapshot (${reason});`));
      assert.match(out.problem.message, /Your sources are saved\. To go on: .+\.$/);
      assert.ok(!out.problem.message.includes("\n"), "one line");
      assert.deepStrictEqual(out.json.error, {
        kind: "PUBLISH_REFUSED",
        message: out.problem.message,
        reason,
        rawReason: reason,
      });
      assert.strictEqual(out.json.pushed, true);
      assert.strictEqual(out.json.historyRecorded, false);
      assert.strictEqual(out.json.publish?.published, false);
    });
  }

  it("UNKNOWN keeps the platform's raw reason and asks for an update", () => {
    const out = pushErrorOutcome(refusal("UNKNOWN", "MOON_PHASE"), false);
    assert.match(
      out?.problem.message ?? "",
      /\(MOON_PHASE\).*the platform gave "MOON_PHASE", which this b6p does not know/
    );
    assert.deepStrictEqual(out?.json.error?.reason, "UNKNOWN");
    assert.deepStrictEqual(out?.json.error?.rawReason, "MOON_PHASE");
  });

  it("UNKNOWN with no raw reason says no reason was given", () => {
    const out = pushErrorOutcome(refusal("UNKNOWN", ""), false);
    assert.match(out?.problem.message ?? "", /the platform gave no reason/);
  });

  it("lists the refused publish's diagnostics, withheld projects, gate problems and entry point", () => {
    const pub = publish({
      published: false,
      diagnostics: [{ origin: "tsc", severity: "error", file: "a.ts", line: 1, column: 2, message: "bad" }],
      diagnosticsOmitted: 3,
      withheld: ["scripts"],
      entrypoint: "scripts/app.js",
      gate: {
        tripped: true,
        withheld: [],
        checked: 1,
        problemsOmitted: 0,
        problems: [{ kind: "K", tsconfig: "t.json", message: "m", accepted: false }],
      },
    });
    const out = pushErrorOutcome(refusal("GATE_TRIPPED", "GATE_TRIPPED", pub), false);
    assert.deepStrictEqual(out?.problem.details, [
      "  a.ts(1,2): error: bad",
      "  ... 3 more diagnostic(s) omitted",
      "  gate [K] t.json: m",
      "  output withheld for: scripts",
      "  entry point: scripts/app.js",
    ]);
  });
});

describe("pushErrorOutcome: Err.ServerCompileRequestError", () => {
  const request = (phase: "compile" | "publish", networkFailure: boolean) =>
    new Err.ServerCompileRequestError(
      networkFailure
        ? `The ${phase} request to the platform failed twice (ECONNRESET). It may or may not have run.`
        : `The platform refused to ${phase}: nope`,
      { phase, messages: networkFailure ? ["ECONNRESET"] : ["nope"], networkFailure }
    );

  it("a network failure tells you to run the push again (compile) or check history / re-run (publish)", () => {
    const c = pushErrorOutcome(request("compile", true), false);
    assert.strictEqual(c?.problem.kind, "COMPILE_REQUEST_FAILED");
    assert.match(c?.problem.message ?? "", /Your sources are saved\. To go on: Run the push again\.$/);
    assert.strictEqual(c?.json.error?.networkFailure, true);
    assert.deepStrictEqual(c?.json.error?.messages, ["ECONNRESET"]);

    const p = pushErrorOutcome(request("publish", true), false);
    assert.strictEqual(p?.problem.kind, "PUBLISH_REQUEST_FAILED");
    assert.match(
      p?.problem.message ?? "",
      /no snapshot is known to have been taken\. To go on: Check the script's snapshot history in the browser, or run the snapshot push again\.$/
    );
  });

  it("a non-network failure points at permission instead of a re-run", () => {
    const out = pushErrorOutcome(request("compile", false), false);
    assert.match(
      out?.problem.message ?? "",
      /To go on: Check that this account may edit the script, then push again\.$/
    );
    assert.strictEqual(out?.json.error?.networkFailure, false);
    assert.deepStrictEqual(out?.json.error?.messages, ["nope"]);
    assert.strictEqual(out?.json.pushed, true, "the sources went up before the request");
  });
});

describe("pushErrorOutcome: Err.FileSendError and the rest", () => {
  it("a refused upload points at the logged details, or carries its own when none were logged", () => {
    const logged = pushErrorOutcome(new Err.FileSendError("PUT scripts/app.ts: 403"), true);
    assert.strictEqual(logged?.problem.kind, "UPLOAD_FAILED");
    assert.match(logged?.problem.message ?? "", /the error above has the details/);
    const bare = pushErrorOutcome(new Err.FileSendError("PUT scripts/app.ts: 403"), false);
    assert.match(bare?.problem.message ?? "", /refused upload \(.*PUT scripts\/app\.ts: 403\)\. Files uploaded/);
    assert.strictEqual(bare?.json.pushed, false);
    assert.strictEqual(bare?.json.error?.kind, "UPLOAD_FAILED");
  });

  it("an error it does not know is left for the top-level handler", () => {
    assert.strictEqual(pushErrorOutcome(new Error("boom"), false), null);
    assert.strictEqual(pushErrorOutcome("string", false), null);
  });
});

describe("toPushJson", () => {
  it("keeps every PushResult field and adds an empty declinedOverwrites and a null error", () => {
    const r = result({ keptPlatformOnly: ["b.ts"] });
    assert.deepStrictEqual(toPushJson(r, false), { ...r, declinedOverwrites: [], error: null });
  });

  it("carries the verdict as error when the push failed", () => {
    const json = toPushJson(result({ compile: compile("EMIT_WITHHELD") }), false);
    assert.strictEqual(json.error?.kind, "COMPILE_EMIT_WITHHELD");
    assert.strictEqual(json.compile?.status, "EMIT_WITHHELD");
  });

  it("is one shape: every failure body has the keys of a clean one", () => {
    const keys = Object.keys(toPushJson(result(), false)).sort();
    const bodies = [
      toPushJson(refusedResult("too-old"), true),
      declinedPushJson([], "x"),
      pushErrorOutcome(new Err.FileSendError("x"), false)?.json,
      pushErrorOutcome(
        new Err.ServerCompileRequestError("x", { phase: "compile", messages: [], networkFailure: true }),
        false
      )?.json,
    ];
    for (const body of bodies) {
      assert.deepStrictEqual(Object.keys(body ?? {}).sort(), keys);
    }
  });
});

// ClickUp 86bc2h3ef: a declined overwrite throws, so no PushResult exists. --json used to print
// nothing at all; it now prints the same shape as every other push, marked as not pushed.
describe("declinedPushJson", () => {
  it("reads as a push that did not run, with the declined files", () => {
    const json = declinedPushJson(["scripts/app.ts", "README.md"], "stopped before uploading");
    assert.deepStrictEqual(json, {
      pushed: false,
      route: null,
      snapshotRefused: null,
      compile: null,
      publish: null,
      historyRecorded: false,
      keptPlatformOnly: [],
      declinedOverwrites: ["scripts/app.ts", "README.md"],
      error: { kind: "OVERWRITE_DECLINED", message: "stopped before uploading" },
    });
  });
});

describe("detectShellDialect", () => {
  it("is POSIX off Windows, and on Windows under Git Bash / MSYS (MSYSTEM or SHELL set)", () => {
    assert.strictEqual(detectShellDialect("linux", {}), "posix");
    assert.strictEqual(detectShellDialect("darwin", {}), "posix");
    assert.strictEqual(detectShellDialect("win32", { MSYSTEM: "MINGW64" }), "posix");
    assert.strictEqual(detectShellDialect("win32", { SHELL: "/usr/bin/bash" }), "posix");
  });

  it("is PowerShell in a plain Windows terminal", () => {
    assert.strictEqual(detectShellDialect("win32", {}), "powershell");
  });
});

// Copilot review on PR #27: the printed commands were POSIX-only while presented as copyable on
// Windows. A `'` is `'\''` in POSIX but `''` in PowerShell, and PowerShell has no printf.
describe("shellQuote", () => {
  it("leaves plain paths, flags and URLs bare in both dialects", () => {
    for (const arg of ["--file", "draft/scripts/app.ts", "https://x.bluestep.net/files/1/draft/", "--message=v1"]) {
      assert.strictEqual(shellQuote(arg, "posix"), arg);
      assert.strictEqual(shellQuote(arg, "powershell"), arg);
    }
  });

  it("POSIX: single-quotes spaces and shell characters, and writes a ' as '\\''", () => {
    assert.strictEqual(shellQuote("My Component/draft/app.ts", "posix"), "'My Component/draft/app.ts'");
    assert.strictEqual(shellQuote("fix $HOME & `x`", "posix"), "'fix $HOME & `x`'");
    assert.strictEqual(shellQuote("it's", "posix"), "'it'\\''s'");
    assert.strictEqual(shellQuote("=cmd", "posix"), "'=cmd'", "zsh expands a leading =");
    assert.strictEqual(shellQuote("", "posix"), "''");
  });

  it("PowerShell: single-quotes, doubles a ', and quotes @ and , which it would parse", () => {
    assert.strictEqual(shellQuote("it's", "powershell"), "'it''s'");
    assert.strictEqual(shellQuote("fix $HOME & `x`", "powershell"), "'fix $HOME & `x`'");
    assert.strictEqual(shellQuote("C:\\U\\My Comp\\draft\\app.ts", "powershell"), "'C:\\U\\My Comp\\draft\\app.ts'");
    assert.strictEqual(shellQuote("@args", "powershell"), "'@args'");
    assert.strictEqual(shellQuote("a,b", "powershell"), "'a,b'");
    assert.strictEqual(shellQuote("", "powershell"), "''");
  });
});

describe("overwriteCommand", () => {
  const args = ["--yes", "push", "--file", "U1/Bob's Comp/draft/scripts/app.ts", "--snapshot"];

  it("repeats the push as given, --yes included, with one --overwrite per declined file", () => {
    assert.strictEqual(
      overwriteCommand(args, ["scripts/app.ts", "README.md"], "posix"),
      "b6p --yes push --file 'U1/Bob'\\''s Comp/draft/scripts/app.ts' --snapshot --overwrite scripts/app.ts --overwrite README.md"
    );
  });

  it("quotes for PowerShell when asked", () => {
    assert.strictEqual(
      overwriteCommand(args, ["scripts/app.ts"], "powershell"),
      "b6p --yes push --file 'U1/Bob''s Comp/draft/scripts/app.ts' --snapshot --overwrite scripts/app.ts"
    );
  });
});

describe("deleteCommand", () => {
  const args = ["--yes", "--json", "push", "--file", "d/app.ts", "--message", "v2 fix"];

  it("POSIX: drops --yes and pipes Yes with printf, keeping every other argument", () => {
    assert.strictEqual(
      deleteCommand(args, "posix"),
      "printf 'Yes\\n' | b6p --json push --file d/app.ts --message 'v2 fix'"
    );
  });

  it("PowerShell: pipes the string 'Yes' (no printf there)", () => {
    assert.strictEqual(deleteCommand(args, "powershell"), "'Yes' | b6p --json push --file d/app.ts --message 'v2 fix'");
  });
});

describe("canonicalPushArgs", () => {
  it("rewrites the deprecated top-level spelling to the noun-first one", () => {
    assert.deepStrictEqual(canonicalPushArgs(["push", "--file", "a.ts"]), ["script", "push", "--file", "a.ts"]);
    assert.deepStrictEqual(canonicalPushArgs(["--yes", "--json", "push", "--file", "a.ts"]), [
      "--yes",
      "--json",
      "script",
      "push",
      "--file",
      "a.ts",
    ]);
  });

  it("leaves the noun-first spelling alone", () => {
    const args = ["--yes", "script", "push", "--file", "a.ts"];
    assert.deepStrictEqual(canonicalPushArgs(args), args);
  });

  it("is what the printed commands use", () => {
    assert.match(
      overwriteCommand(canonicalPushArgs(["push"]), ["a.ts"], "posix"),
      /^b6p script push --overwrite a\.ts$/
    );
    assert.match(deleteCommand(canonicalPushArgs(["--yes", "push"]), "posix"), /b6p script push$/);
  });
});
