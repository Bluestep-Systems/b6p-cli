import { bsjsGit, type BuildIncomplete, type PushResult, type SnapshotRefusal } from "@bluestep-systems/b6p-core";
import { describePublishRefusal } from "./publishRefusal";

/**
 * The exact error line for a snapshot push to a server that does not build git drafts (ruling 46). Brendan's
 * wording, pinned by a test: scripts match on it, so do not reword it.
 * @lastreviewed null
 */
export const SNAPSHOT_REFUSED_LINE = "cannot snapshot, only push saves";

/**
 * Why a push is reported as failed, as a machine-readable tag in `--json`'s `error.kind`. Stable: a consumer
 * branches on it.
 * @lastreviewed null
 */
export type PushErrorKind =
  | "NOTHING_PUSHED"
  | "SNAPSHOT_REFUSED"
  | "BUILD_NOT_REQUESTED"
  | "BUILD_REQUEST_FAILED"
  | "BUILD_OUTCOME_UNKNOWN"
  | "BUILD_INCOMPLETE"
  | "BUILD_BLOCKED"
  | "BUILD_TAKE_IN_FAILED"
  | "PUBLISH_REFUSED"
  | "PUBLISH_FAILED"
  | "NOT_PUBLISHED"
  | "LIVE_MISMATCH"
  | "TYPE_ERRORS"
  | "OVERWRITE_DECLINED"
  | "NO_AUTHOR"
  | "AUTHOR_INVALID"
  | "GIT_REFUSED";

/**
 * `--json`'s `error`: why the push failed (`kind`), what happened (`message`) and what to do (`howTo`), the same
 * words printed on stderr.
 * @lastreviewed null
 */
export interface PushErrorJson {
  /**
   * The tag a consumer branches on.
   * @lastreviewed null
   */
  kind: PushErrorKind;
  /**
   * What happened, in one sentence.
   * @lastreviewed null
   */
  message: string;
  /**
   * What to do next (may name `b6p` commands and flags), or `null` when there is nothing to do.
   * @lastreviewed null
   */
  howTo: string | null;
}

/**
 * What `b6p script push --json` prints: core's {@link PushResult}, the files a declined overwrite left alone, and
 * the CLI's verdict. One shape for every outcome, so a machine consumer parses a single schema.
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
   * Why the push is reported as failed (and exits `1`), `null` when it succeeded. Same rule as the exit code.
   * @lastreviewed null
   */
  error: PushErrorJson | null;
};

/**
 * The fields of a push result the verdict reads: all of {@link PushResult}'s, and the ones a deploy target result
 * carries too, so a deploy is judged by the same rule.
 * @lastreviewed null
 */
export type PushVerdictInput = Pick<
  PushResult,
  | "pushed"
  | "snapshotRefused"
  | "buildError"
  | "buildErrorKind"
  | "buildIncomplete"
  | "buildFastForward"
  | "buildCommitSha"
  | "publishError"
  | "publishRefusal"
  | "publishedSha"
  | "liveVerified"
  | "typeCheckErrors"
>;

/**
 * What to do after a build status that does not publish. `UNKNOWN` (a status this b6p does not know) says to update
 * b6p; core's "outcome unknown" answer is handled before this (pull, then push).
 * @lastreviewed null
 */
const INCOMPLETE_HOW_TO: Record<string, string> = {
  BUSY: "Run `b6p script push` again in a minute.",
  INPUT_INCOMPLETE: "Run `b6p script push` again.",
  WRITE_FAILED: "Run `b6p script push` again, and report it if it repeats.",
  COMPILER_UNAVAILABLE: "Run `b6p script push` again later; the platform's compiler is unavailable.",
  NOT_PERMITTED: "Ask for edit access to this script, then push again.",
  OUTPUT_UPLOAD:
    "Push only sources: remove the build output files from the draft folder's output folder, then push again.",
  SKIPPED_GIT_MANAGED: "This server does not build git drafts. Push again once the server is updated.",
  GATE_TRIPPED: "Fix the save-gate problems listed above, then push again.",
  EMIT_WITHHELD: "Fix the errors listed above, then push again.",
  UNKNOWN: "Update b6p (this version does not know that build status), then push again.",
};

/**
 * Whether a build that did not publish was core's "outcome unknown" answer: the platform could not tell whether its
 * build commit landed.
 * @param incomplete The push's `buildIncomplete`
 * @lastreviewed null
 */
function isOutcomeUnknown(incomplete: BuildIncomplete): boolean {
  return incomplete.rawStatus === bsjsGit.BUILD_OUTCOME_UNKNOWN_REASON;
}

/**
 * What to do about a snapshot the server could not take.
 * @param refused The push's `snapshotRefused`
 * @lastreviewed null
 */
function snapshotRefusedHowTo(refused: SnapshotRefusal): string {
  switch (refused.reason) {
    case "too-old":
      return (
        `The draft is saved. The server runs ${refused.serverVersion ?? "an older release"}; run ` +
        `\`b6p script push --snapshot\` again once it runs ${refused.required ?? "a release that builds git drafts"} or later.`
      );
    case "floor-unset":
      return "The draft is saved. Update b6p: this version does not know which server release builds git drafts.";
    default:
      return (
        "The draft is saved. The server's version could not be read (`--verbose` shows the route); run " +
        "`b6p script push --snapshot` again once the server answers."
      );
  }
}

/**
 * Why a finished push is reported as failed, or `null` when it is not. The one rule behind the exit code, the
 * CLI's error line and `--json`'s `error`. Core already prints what happened and why; `howTo` is the CLI's.
 *
 * Failures, in order: nothing pushed; a snapshot the server cannot take (`snapshotRefused`); a build that was not
 * asked for or whose request failed (`buildError`); a build that ended in a status that does not publish
 * (`buildIncomplete`, core's "outcome unknown" included); a build the draft folder could not be moved to
 * (`buildFastForward` `blocked` or `failed`); on a snapshot, a publish that was refused, failed, published nothing or
 * reads back at another commit; with `failOnTypeErrors`, any diagnostic in the script's own sources
 * (`typeCheckErrors`).
 *
 * Not failures: the user cancelling at the target-URL prompt (`null`); a plain push on the push-only route (an older
 * server: the draft is pushed, nothing is built); an unclean build on a plain push (`buildVouched: false`, the push
 * succeeds and a later snapshot is refused, ruling 62); `liveVerified: null`; kept platform-only files.
 * @param result What core's push returned
 * @param snapshot Whether the push asked to publish (`--snapshot`, or `--message`, which implies it)
 * @param failOnTypeErrors Whether diagnostics in the script's own sources fail the push (`--fail-on-type-errors`)
 * @returns The verdict, or `null`
 * @lastreviewed null
 */
export function pushProblem(
  result: PushVerdictInput,
  snapshot: boolean,
  failOnTypeErrors = false
): PushErrorJson | null {
  if (!result.pushed) {
    return {
      kind: "NOTHING_PUSHED",
      message: "Nothing was pushed.",
      howTo: "Check that the target has a draft/ folder with files in it, then push again.",
    };
  }
  if (result.snapshotRefused) {
    return {
      kind: "SNAPSHOT_REFUSED",
      message: SNAPSHOT_REFUSED_LINE,
      howTo: snapshotRefusedHowTo(result.snapshotRefused),
    };
  }
  if (result.buildError !== null) {
    return result.buildErrorKind === "not-requested"
      ? {
          kind: "BUILD_NOT_REQUESTED",
          message: `The draft was pushed, but no build was asked for: ${result.buildError}`,
          howTo: "The platform's draft moved after this push. Run `b6p script pull`, then `b6p script push` again.",
        }
      : {
          kind: "BUILD_REQUEST_FAILED",
          message: `The draft was pushed, but the platform's build request failed: ${result.buildError}`,
          howTo: "Run `b6p script push` again: if the build landed after all, the next push takes it in.",
        };
  }
  const incomplete = result.buildIncomplete;
  if (incomplete) {
    if (isOutcomeUnknown(incomplete)) {
      return {
        kind: "BUILD_OUTCOME_UNKNOWN",
        message: `The draft was pushed, but ${incomplete.description}.`,
        howTo: "Run `b6p script pull`, then `b6p script push` again.",
      };
    }
    return {
      kind: "BUILD_INCOMPLETE",
      message: `The draft was pushed, but ${incomplete.description} (${incomplete.rawStatus || incomplete.status}).`,
      howTo: INCOMPLETE_HOW_TO[incomplete.status] ?? "Run `b6p script push` again.",
    };
  }
  const moved = result.buildFastForward;
  if (moved?.state === "blocked") {
    return {
      kind: "BUILD_BLOCKED",
      message:
        `The platform built the draft (${result.buildCommitSha ?? "build commit"}), but ${moved.blockedPaths.length} ` +
        "local file(s) the build changes are in the way, so the draft folder was not moved to it.",
      howTo: blockedHowTo(moved.blockedPaths),
    };
  }
  if (moved?.state === "failed") {
    return {
      kind: "BUILD_TAKE_IN_FAILED",
      message: `The platform built the draft, but the draft folder could not be moved to the build: ${moved.error ?? "unknown error"}`,
      howTo: "Run `b6p script pull` to take in the platform's build, then push again if you need a snapshot.",
    };
  }
  if (snapshot) {
    if (result.publishError !== null) {
      return result.publishRefusal
        ? {
            kind: "PUBLISH_REFUSED",
            message: `The draft was pushed but the platform refused to publish it: ${result.publishError}`,
            howTo: describePublishRefusal(result.publishRefusal),
          }
        : {
            kind: "PUBLISH_FAILED",
            message: `The draft was pushed but the platform did not publish it: ${result.publishError}`,
            howTo: "Run `b6p script push --snapshot` again.",
          };
    }
    if (result.publishedSha === null) {
      return {
        kind: "NOT_PUBLISHED",
        message: "The draft was pushed, but the platform did not report a published commit; nothing was published.",
        howTo: "Run `b6p script push --snapshot` again.",
      };
    }
    if (result.liveVerified === false) {
      return {
        kind: "LIVE_MISMATCH",
        message: `The platform reports publishing ${result.publishedSha}, but its published branch is at another commit.`,
        howTo: "Run `b6p script push --snapshot` again.",
      };
    }
  }
  if (failOnTypeErrors && result.typeCheckErrors.length > 0) {
    return {
      kind: "TYPE_ERRORS",
      message: `The platform's build reported ${result.typeCheckErrors.length} diagnostic(s) in the script's own sources.`,
      howTo: "Fix them and push again, or push without --fail-on-type-errors to treat them as warnings.",
    };
  }
  return null;
}

/**
 * What to do when local files block taking in the platform's build (a finished push, or a later push that stops on
 * `GitBuildFastForwardBlockedError`).
 * @param paths The files in the way
 * @lastreviewed null
 */
export function blockedHowTo(paths: readonly string[]): string {
  return (
    "Move or delete these local files (the platform's build replaces them; keep a copy of any you edited), then run " +
    `\`b6p script push\` again: it takes in the build first.\n  ${paths.join("\n  ")}`
  );
}

/**
 * The shell exit code for a finished push: `1` when {@link pushProblem} has a verdict, `0` otherwise (and for
 * `null`, the user cancelling at the target-URL prompt).
 * @param result What core's push returned
 * @param snapshot Whether the push asked to publish
 * @param failOnTypeErrors Whether diagnostics in the script's own sources fail the push (`--fail-on-type-errors`)
 * @returns `1` when the push must read as failed, `0` otherwise
 * @lastreviewed null
 */
export function pushExitCode(result: PushResult | null, snapshot: boolean, failOnTypeErrors = false): 0 | 1 {
  return result !== null && pushProblem(result, snapshot, failOnTypeErrors) !== null ? 1 : 0;
}

/**
 * The "how to go on" for a push that succeeded but left something to do: an unclean build, whose output was
 * committed without a manifest, so a snapshot of this draft is refused until it builds cleanly.
 * @param result What core's push returned
 * @returns A notice, or `null`
 * @lastreviewed null
 */
export function pushAdvice(result: PushResult): string | null {
  if (result.pushed && result.buildVouched === false && result.buildIncomplete === null) {
    return "To publish this draft, fix the ERROR diagnostics the build reported and push again: a snapshot is refused until it builds cleanly.";
  }
  return null;
}

/**
 * What a human is told when a script was switched from WebDAV to git.
 * @lastreviewed null
 */
export const SWITCHED_TO_GIT_NOTICE =
  "This script was switched from WebDAV to git publishing. The switch is one-way: its draft and snapshot " +
  "no longer accept WebDAV writes, and its history is now its git history.";

/**
 * The plain-language lines after a push. Core already prints errors and warnings (what happened and why), so the CLI
 * adds only the commit ids (hidden under `--json`) and its notices: how to go on, and (loudly) a switch to git.
 * @param result What core's push returned
 * @param snapshot Whether the push asked to publish
 * @param failOnTypeErrors Whether diagnostics fail the push
 * @returns `info` lines and `notices` (shown in every mode, because an agent must not miss them)
 * @lastreviewed null
 */
export function describePush(
  result: PushResult,
  snapshot: boolean,
  failOnTypeErrors = false
): { info: string[]; notices: string[] } {
  const info: string[] = [];
  const notices: string[] = [];
  if (result.commitSha !== null) {
    info.push(`Draft commit: ${result.commitSha}`);
  }
  if (result.buildCommitSha !== null) {
    info.push(`Build commit: ${result.buildCommitSha}`);
  }
  if (result.publishedSha !== null) {
    info.push(`Published commit: ${result.publishedSha}`);
  }
  const problem = pushProblem(result, snapshot, failOnTypeErrors);
  if (problem?.howTo) {
    notices.push(`To go on: ${problem.howTo}`);
  }
  const advice = problem === null ? pushAdvice(result) : null;
  if (advice) {
    notices.push(advice);
  }
  if (result.switchedToGit) {
    notices.push(SWITCHED_TO_GIT_NOTICE);
  }
  return { info, notices };
}

/**
 * Lines for `--verbose`: which route the push took and why. `--json` carries the same facts as `route`.
 * @param result What core's push returned
 * @lastreviewed null
 */
export function routeVerboseLines(result: PushResult): string[] {
  const route = result.route;
  if (!route) {
    return [];
  }
  return [
    `Push route: ${route.mode} (${route.reason}; server version ${route.serverVersion ?? "unknown"}, ` +
      `required ${route.required ?? "not set"})`,
  ];
}

/**
 * The `--json` body for a push that returned a result.
 * @param result What core's push returned
 * @param snapshot Whether the push asked to publish
 * @param failOnTypeErrors Whether diagnostics fail the push
 * @returns The result with `declinedOverwrites: []` and the verdict as `error`
 * @lastreviewed null
 */
export function toPushJson(result: PushResult, snapshot: boolean, failOnTypeErrors = false): PushJson {
  return { ...result, declinedOverwrites: [], error: pushProblem(result, snapshot, failOnTypeErrors) };
}

/**
 * The `--json` body for a push that stopped before anything was pushed (core threw): every other field reads as
 * "did not run".
 * @param error The verdict
 * @param paths The files whose overwrite was not confirmed (`err.paths` of a declined overwrite), else empty
 * @param switchedToGit Whether the push had already switched the script to git before it stopped (the switch stands)
 * @returns A {@link PushJson} with `pushed: false`
 * @lastreviewed null
 */
export function declinedPushJson(error: PushErrorJson, paths: string[] = [], switchedToGit = false): PushJson {
  return {
    pushed: false,
    commitSha: null,
    publishedSha: null,
    publishError: null,
    publishRefusal: null,
    switchedToGit,
    route: null,
    snapshotRefused: null,
    build: null,
    buildCommitSha: null,
    buildVouched: null,
    buildError: null,
    buildErrorKind: null,
    buildIncomplete: null,
    buildFastForward: null,
    typeCheckDiagnostics: null,
    typeCheckErrors: [],
    liveVerified: null,
    liveMismatches: [],
    keptPlatformOnly: [],
    declinedOverwrites: [...paths],
    error,
  };
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
