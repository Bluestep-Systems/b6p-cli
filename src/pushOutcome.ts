import {
  Err,
  compileAllowsPublish,
  type CompileDiagnostic,
  type GateReport,
  type PublishRefusalReason,
  type PushResult,
} from "@bluestep-systems/b6p-core";

/**
 * The exact error line for a snapshot push to a server without server-side compile (ruling 46).
 * Brendan's wording, pinned by a test: scripts match on it.
 * @lastreviewed null
 */
export const SNAPSHOT_REFUSED_LINE = "cannot snapshot, only push saves";

/**
 * Why a push finished without success, as a machine-readable tag. Stable: a consumer branches on it.
 * @lastreviewed null
 */
export type PushErrorKind =
  | "NOTHING_PUSHED"
  | "SNAPSHOT_REFUSED"
  | "COMPILE_GATE_TRIPPED"
  | "COMPILE_EMIT_WITHHELD"
  | "COMPILE_NOT_BUILT"
  | "NOT_PUBLISHED"
  | "HISTORY_NOT_RECORDED"
  | "PUBLISH_REFUSED"
  | "COMPILE_REQUEST_FAILED"
  | "PUBLISH_REQUEST_FAILED"
  | "UPLOAD_FAILED"
  | "OVERWRITE_DECLINED";

/**
 * The `error` member of {@link PushJson}: the same sentence the CLI printed as its one error line,
 * plus the fields that belong to the kind (`reason`/`rawReason` for a publish refusal,
 * `networkFailure`/`messages` for a failed request).
 * @lastreviewed null
 */
export interface PushErrorJson {
  kind: PushErrorKind;
  message: string;
  /** A publish refusal's reason, `UNKNOWN` for one this CLI does not know. @lastreviewed null */
  reason?: PublishRefusalReason;
  /** The refusal reason exactly as the platform sent it. @lastreviewed null */
  rawReason?: string;
  /** True when a compile or publish request failed on the network, so it may or may not have run. @lastreviewed null */
  networkFailure?: boolean;
  /** The platform's error messages for a failed request. @lastreviewed null */
  messages?: string[];
}

/**
 * What `b6p push --json` prints: core's {@link PushResult} plus the files a declined overwrite
 * left alone and the CLI's verdict. One shape for every outcome, so a machine consumer parses a
 * single schema. When core threw instead of returning (a publish refusal, a failed request, a
 * refused upload) there is no result, so `route` and `compile` read `null` ("not known") and the
 * fields core's error carries are filled in.
 * @lastreviewed null
 */
export type PushJson = PushResult & {
  /**
   * Draft-relative, `/`-separated paths whose overwrite was not confirmed. Empty unless the push
   * stopped at the overwrite confirmation, in which case `pushed` is false and nothing was uploaded.
   * @lastreviewed null
   */
  declinedOverwrites: string[];
  /**
   * Why the push is reported as failed (and exits non-zero), `null` when it succeeded.
   * @lastreviewed null
   */
  error: PushErrorJson | null;
};

/**
 * One failed-push verdict: the single error line, its kind, and the detail lines that explain it
 * (compile diagnostics, gate problems, withheld projects). Details go to stderr before the line.
 * @lastreviewed null
 */
export interface PushProblem {
  kind: PushErrorKind;
  /** The one error line: what happened, then what to do. @lastreviewed null */
  message: string;
  /** Extra stderr lines that make the error line actionable. Empty when there are none. @lastreviewed null */
  details: string[];
  /** Extra {@link PushErrorJson} members for the kind. @lastreviewed null */
  extra?: Omit<PushErrorJson, "kind" | "message">;
}

/** Statuses after which the platform's output was not updated, with what the user can do about each. */
const NOT_BUILT_HINTS: Record<string, string> = {
  NOT_PERMITTED: "this account may not compile the script on the platform",
  COMPILER_UNAVAILABLE: "its compiler is unavailable; try again later",
  WRITE_FAILED: "it could not write its output; push again, and report it if it repeats",
  INPUT_INCOMPLETE: "the sources were not all in place after core's retries; push again",
  BUSY: "it stayed busy through core's retries; push again in a minute",
  OUTPUT_UPLOAD: "output files were uploaded straight into the build folder, so it skipped compiling",
};

/**
 * One diagnostic as a line: `file(line,col): severity TS1234: message` where the platform gave a
 * position, else `[origin] severity: message`.
 * @param d A diagnostic from the platform's compile
 * @lastreviewed null
 */
export function formatDiagnostic(d: CompileDiagnostic): string {
  const code = d.code === undefined ? "" : ` ${d.code}`;
  if (d.file !== undefined) {
    const at = d.line !== undefined ? `(${d.line},${d.column ?? 0})` : "";
    return `${d.file}${at}: ${d.severity}${code}: ${d.message}`;
  }
  return `[${d.origin}] ${d.severity}${code}: ${d.message}`;
}

/**
 * The detail lines for a compile or publish: its diagnostics, the gate's problems and the projects
 * whose output was withheld. Core caps the lists and counts what it dropped; the count is shown.
 * @param what What the platform reported
 * @returns Lines for stderr, empty when there is nothing to say
 * @lastreviewed null
 */
export function compileDetailLines(what: {
  diagnostics: CompileDiagnostic[];
  diagnosticsOmitted: number;
  gate?: GateReport;
  withheld?: string[];
}): string[] {
  const lines: string[] = [];
  for (const d of what.diagnostics) {
    lines.push(`  ${formatDiagnostic(d)}`);
  }
  if (what.diagnosticsOmitted > 0) {
    lines.push(`  ... ${what.diagnosticsOmitted} more diagnostic(s) omitted`);
  }
  const gate = what.gate;
  if (gate) {
    for (const p of gate.problems) {
      if (p.accepted) {
        continue;
      }
      const at = p.file ? `${p.tsconfig} ${p.file}` : p.tsconfig;
      lines.push(`  gate [${p.kind}] ${at}: ${p.message}`);
    }
    if (gate.problemsOmitted > 0) {
      lines.push(`  ... ${gate.problemsOmitted} more gate problem(s) omitted`);
    }
  }
  const withheld = [...(what.withheld ?? []), ...(gate?.withheld ?? [])];
  if (withheld.length > 0) {
    lines.push(`  output withheld for: ${[...new Set(withheld)].join(", ")}`);
  }
  return lines;
}

/**
 * Lines for `--verbose` only: which route the push took and why, and the versions behind a
 * snapshot refusal. `--json` carries the same facts as `route` and `snapshotRefused`.
 * @param result What core's push returned
 * @lastreviewed null
 */
export function routeVerboseLines(result: PushResult): string[] {
  const lines: string[] = [];
  const route = result.route;
  if (route) {
    lines.push(
      `Push route: ${route.mode} (${route.reason}; server version ${route.serverVersion ?? "unknown"}, ` +
        `required ${route.required ?? "not set"})`
    );
  }
  const refused = result.snapshotRefused;
  if (refused) {
    lines.push(
      `Snapshot refused: ${refused.reason} (server version ${refused.serverVersion ?? "unknown"}, ` +
        `required ${refused.required ?? "not set"})`
    );
  }
  return lines;
}

/**
 * The detail lines for a finished push (compile diagnostics, gate problems, withheld projects),
 * printed whether or not the push failed: a clean compile with warnings is still worth showing.
 * @param result What core's push returned
 * @lastreviewed null
 */
export function pushDetailLines(result: PushResult): string[] {
  const lines: string[] = [];
  if (result.compile) {
    lines.push(...compileDetailLines(result.compile));
  }
  if (result.publish) {
    lines.push(...compileDetailLines(result.publish));
  }
  return lines;
}

/**
 * Why a push that returned a result is reported as failed, or `null` when it is not. The one rule
 * behind the exit code, the error line and `--json`'s `error`; core says what happened, the line
 * here adds what to do.
 *
 * Failures: nothing uploaded; a snapshot asked of a server without server-side compile (the draft
 * was saved, nothing published); a compile that left the platform's output un-updated (`GATE_TRIPPED`,
 * `EMIT_WITHHELD`, or any other status that does not build, `UNKNOWN` included) on a plain push as
 * well as a snapshot; a snapshot that published nothing or published without a history entry.
 *
 * Not failures: `null` (cancelled at the target-URL prompt); a plain push on the draft-only route
 * (sources saved, the usual case on an older server); `COMPILED` with errors on a plain push (the
 * sources and output are saved, the diagnostics are printed); `SKIPPED_GIT_MANAGED` on a plain push;
 * platform-only files kept.
 * @param result What core's push returned
 * @param snapshot Whether a snapshot was asked for
 * @returns The verdict, or `null`
 * @lastreviewed null
 */
export function pushProblem(result: PushResult, snapshot: boolean): PushProblem | null {
  if (!result.pushed) {
    return {
      kind: "NOTHING_PUSHED",
      message: "Nothing was pushed. Check that the target has a draft/ folder with files in it.",
      details: [],
    };
  }
  if (result.snapshotRefused) {
    return { kind: "SNAPSHOT_REFUSED", message: SNAPSHOT_REFUSED_LINE, details: [] };
  }
  const compile = result.compile;
  const tail = snapshot ? " and nothing was published" : "";
  if (compile) {
    const details = pushDetailLines(result);
    if (compile.status === "GATE_TRIPPED") {
      return {
        kind: "COMPILE_GATE_TRIPPED",
        message:
          `The platform's save gate stopped the compile: your sources are saved, but its compiled output was ` +
          `not updated${tail}. Fix the problems listed above and push again.`,
        details,
      };
    }
    if (compile.status === "EMIT_WITHHELD") {
      return {
        kind: "COMPILE_EMIT_WITHHELD",
        message:
          `The platform withheld its compiled output because of type errors (noEmitOnError): your sources are ` +
          `saved, but the output was not updated${tail}. Fix the errors listed above and push again.`,
        details,
      };
    }
    if (!compileAllowsPublish(compile.status) && compile.status !== "SKIPPED_GIT_MANAGED") {
      const hint =
        compile.status === "UNKNOWN"
          ? `status "${compile.rawStatus}" is not one this b6p knows; update b6p if this persists`
          : (NOT_BUILT_HINTS[compile.status] ?? `status ${compile.status}`);
      return {
        kind: "COMPILE_NOT_BUILT",
        message: `Your sources are saved, but the platform's compile ended as ${compile.rawStatus || compile.status} (${hint}), so its output was not updated${tail}.`,
        details,
      };
    }
  }
  if (snapshot) {
    if (!result.publish || !result.publish.published) {
      return {
        kind: "NOT_PUBLISHED",
        message:
          compile?.status === "SKIPPED_GIT_MANAGED"
            ? "Your sources are saved, but no snapshot was taken: the platform skipped the compile because the script is managed by git."
            : "Your sources are saved, but no snapshot was published. Run the snapshot push again.",
        details: pushDetailLines(result),
      };
    }
    if (!result.historyRecorded) {
      return {
        kind: "HISTORY_NOT_RECORDED",
        message:
          "Snapshot files were uploaded, but the snapshot history entry was NOT recorded - " +
          "the browser IDE has no restore point for this snapshot. Run the snapshot push again.",
        details: [],
      };
    }
  }
  return null;
}

/**
 * The shell exit code for a finished push: `1` when {@link pushProblem} has a verdict, `0` otherwise.
 * A push that uploaded nothing (bad `--root`, empty draft) must not report success: that is what
 * let a typo'd `--root` mark a deploy green.
 * @param result What core's push returned; `null` when the user cancelled at the target-URL prompt
 * @param snapshot Whether a snapshot was asked for
 * @returns `1` when the push must read as failed, `0` otherwise
 * @lastreviewed null
 */
export function pushExitCode(result: PushResult | null, snapshot: boolean): 0 | 1 {
  return result !== null && pushProblem(result, snapshot) !== null ? 1 : 0;
}

/**
 * The `--json` body for a push that returned a result.
 * @param result What core's push returned
 * @param snapshot Whether a snapshot was asked for
 * @returns The result with `declinedOverwrites: []` and the verdict as `error`
 * @lastreviewed null
 */
export function toPushJson(result: PushResult, snapshot: boolean): PushJson {
  const problem = pushProblem(result, snapshot);
  return {
    ...result,
    declinedOverwrites: [],
    error: problem ? { kind: problem.kind, message: problem.message, ...problem.extra } : null,
  };
}

/** The body for a push that never produced a result: everything reads as "did not run" or "unknown". */
function blankJson(error: PushErrorJson): PushJson {
  return {
    pushed: false,
    route: null,
    snapshotRefused: null,
    compile: null,
    publish: null,
    historyRecorded: false,
    keptPlatformOnly: [],
    declinedOverwrites: [],
    error,
  };
}

/**
 * The `--json` body for a push that stopped at the overwrite confirmation (core threw
 * `Err.OverwriteDeclinedError`): nothing was uploaded, so every other field reads as "did not run".
 * @param paths The files whose overwrite was not confirmed (`err.paths`)
 * @param message The error's message (`err.message`)
 * @returns A {@link PushJson} with `pushed: false` and the files in `declinedOverwrites`
 * @lastreviewed null
 */
export function declinedPushJson(paths: string[], message: string): PushJson {
  return { ...blankJson({ kind: "OVERWRITE_DECLINED", message }), declinedOverwrites: [...paths] };
}

/** What to do about each reason the platform can refuse to publish a snapshot. */
const REFUSAL_HINTS: Record<Exclude<PublishRefusalReason, "UNKNOWN">, string> = {
  GATE_TRIPPED: "fix the save-gate problems listed above and run the snapshot push again",
  EMIT_WITHHELD: "fix the type errors listed above (a noEmitOnError project) and run the snapshot push again",
  ENTRYPOINT_MISSING:
    "the compile produced no output for the script's entry point; check that it exists in draft/ and compiles",
  OUTPUT_SHADOWS: "compiled output would collide with an existing file; move or rename the file named above",
  COMPILER_UNAVAILABLE: "the platform's compiler is unavailable; run the snapshot push again later",
  BUSY: "the platform is busy; run the snapshot push again in a minute",
  INPUT_INCOMPLETE: "the pushed sources were not all in place; run the snapshot push again",
  WRITE_FAILED: "the platform could not write the snapshot; run the snapshot push again, and report it if it repeats",
  NOT_PERMITTED: "this account may not publish the script; ask for edit access",
};

/**
 * How a thrown core push error reads: the verdict, and the `--json` body.
 * @lastreviewed null
 */
export interface PushErrorOutcome {
  problem: PushProblem;
  json: PushJson;
}

/**
 * Maps the errors core throws out of a push after the upload has started: a refused publish
 * (`Err.PublishRefusedError`), a failed compile or publish request (`Err.ServerCompileRequestError`)
 * and a refused upload (`Err.FileSendError`). Anything else is not this function's to explain.
 * @param error What core threw
 * @param alreadyLogged Whether core's logger already printed the error's message (it logs a refused
 *   upload and then rethrows it)
 * @returns The one-line verdict and the `--json` body, or `null` for an error this does not know
 * @lastreviewed null
 */
export function pushErrorOutcome(error: unknown, alreadyLogged: boolean): PushErrorOutcome | null {
  if (error instanceof Err.PublishRefusedError) {
    const how =
      error.reason === "UNKNOWN"
        ? `the platform gave ${error.rawReason ? `"${error.rawReason}"` : "no reason"}, which this b6p does not know; update b6p if this persists`
        : REFUSAL_HINTS[error.reason];
    const details = compileDetailLines(error.publish);
    if (error.publish.entrypoint) {
      details.push(`  entry point: ${error.publish.entrypoint}`);
    }
    const message = `${error.message} Your sources are saved. To go on: ${how}.`;
    const extra = { reason: error.reason, rawReason: error.rawReason };
    return {
      problem: { kind: "PUBLISH_REFUSED", message, details, extra },
      json: {
        ...blankJson({ kind: "PUBLISH_REFUSED", message, ...extra }),
        pushed: true,
        publish: error.publish,
      },
    };
  }
  if (error instanceof Err.ServerCompileRequestError) {
    const publishing = error.phase === "publish";
    const kind = publishing ? "PUBLISH_REQUEST_FAILED" : "COMPILE_REQUEST_FAILED";
    const how = error.networkFailure
      ? publishing
        ? "Check the script's snapshot history in the browser, or run the snapshot push again"
        : "Run the push again"
      : "Check that this account may edit the script, then push again";
    const message = `${error.message} Your sources are saved${publishing ? ", but no snapshot is known to have been taken" : ""}. To go on: ${how}.`;
    const extra = { networkFailure: error.networkFailure, messages: error.messages };
    return {
      problem: { kind, message, details: [], extra },
      json: { ...blankJson({ kind, message, ...extra }), pushed: true },
    };
  }
  if (error instanceof Err.FileSendError) {
    const message = alreadyLogged
      ? "Push stopped at a refused upload: the error above has the details. Files uploaded before it are saved in the draft."
      : `Push stopped at a refused upload (${error.message}). Files uploaded before it are saved in the draft.`;
    return {
      problem: { kind: "UPLOAD_FAILED", message, details: [] },
      json: blankJson({ kind: "UPLOAD_FAILED", message }),
    };
  }
  return null;
}

/**
 * The shell syntax for the commands the CLI prints: POSIX (bash, zsh, Git Bash, WSL) or PowerShell.
 * They quote differently (a `'` is `'\''` in POSIX, `''` in PowerShell) and pipe an answer
 * differently (`printf` doesn't exist in PowerShell). `cmd.exe` is not targeted.
 * @lastreviewed null
 */
export type ShellDialect = "posix" | "powershell";

/**
 * Which shell a printed command should be written for. POSIX everywhere except Windows outside
 * Git Bash / MSYS2 / Cygwin, which set `MSYSTEM` or `SHELL` (Claude Code on Windows runs its Bash
 * tool there); plain Windows terminals default to PowerShell.
 * @param platform `process.platform`
 * @param env `process.env`
 * @returns The dialect to quote for
 * @lastreviewed null
 */
export function detectShellDialect(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): ShellDialect {
  if (platform !== "win32") {
    return "posix";
  }
  return env.MSYSTEM || env.SHELL ? "posix" : "powershell";
}

/**
 * Quote one argument for `dialect`, left bare when it has nothing that shell would touch. Both
 * dialects single-quote, which neither expands; they differ in how a `'` inside is written.
 * @param arg One command-line argument
 * @param dialect The shell the command is printed for
 * @returns The argument, single-quoted if needed
 * @lastreviewed null
 */
export function shellQuote(arg: string, dialect: ShellDialect): string {
  // PowerShell reads a leading `@` as splatting and `,` as the array operator, so neither is bare there.
  const bare = dialect === "posix" ? /^[A-Za-z0-9_\-./:%+,@][A-Za-z0-9_\-./:=%+,@]*$/ : /^[A-Za-z0-9_\-./:=%+]+$/;
  if (bare.test(arg)) {
    return arg;
  }
  const escaped = dialect === "posix" ? arg.replace(/'/g, `'\\''`) : arg.replace(/'/g, "''");
  return `'${escaped}'`;
}

/**
 * The command that repeats a push with the declined files confirmed: the user's own arguments,
 * `--yes` included (it only declines what `--overwrite` doesn't name), plus one `--overwrite` per
 * file.
 * @param args The push's arguments as given (`process.argv.slice(2)`)
 * @param paths The files to confirm, as core listed them
 * @param dialect The shell the command is printed for
 * @returns A copyable command line
 * @lastreviewed null
 */
export function overwriteCommand(args: string[], paths: string[], dialect: ShellDialect): string {
  const all = [...args, ...paths.flatMap((p) => ["--overwrite", p])];
  return ["b6p", ...all.map((a) => shellQuote(a, dialect))].join(" ");
}

/**
 * The command that repeats a push and answers "Yes" to its delete question. There is no delete
 * flag (core takes no list of files to delete up front), so it drops `--yes` and pipes the answer.
 * By then the files are in sync, so the delete question is the only one left; if anything else
 * asks first, "Yes" matches none of its answers and it declines, which is safe.
 * @param args The push's arguments as given (`process.argv.slice(2)`)
 * @param dialect The shell the command is printed for
 * @returns A copyable command line
 * @lastreviewed null
 */
export function deleteCommand(args: string[], dialect: ShellDialect): string {
  const kept = args.filter((a) => a !== "--yes");
  const push = ["b6p", ...kept.map((a) => shellQuote(a, dialect))].join(" ");
  return dialect === "posix" ? `printf 'Yes\\n' | ${push}` : `'Yes' | ${push}`;
}

/**
 * The user's push arguments with the deprecated top-level spelling (`b6p push`) rewritten to the
 * noun-first one (`b6p script push`), so a printed follow-up command never hands out the alias.
 * The root flags (`--yes`, `--json`, `--verbose`, `--quiet`) take no value, so the first argument
 * that is not an option is the command.
 * @param args The push's arguments as given (`process.argv.slice(2)`)
 * @returns The same arguments, with `script` inserted before a bare `push`
 * @lastreviewed null
 */
export function canonicalPushArgs(args: string[]): string[] {
  const at = args.findIndex((a) => !a.startsWith("-"));
  if (at === -1 || args[at] !== "push") {
    return args;
  }
  return [...args.slice(0, at), "script", ...args.slice(at)];
}
