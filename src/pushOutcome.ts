import type { PushResult } from "@bluestep-systems/b6p-core";
import { describePublishRefusal } from "./publishRefusal";

/**
 * What `b6p push --json` prints: core's {@link PushResult} plus the files a declined overwrite
 * left alone. One shape for every outcome, so a machine consumer parses a single schema.
 * @lastreviewed null
 */
export type PushJson = PushResult & {
  /**
   * Draft-relative, `/`-separated paths whose overwrite was not confirmed. Empty unless the push
   * stopped at the overwrite confirmation, in which case `pushed` is false and nothing was uploaded.
   * @lastreviewed null
   */
  declinedOverwrites: string[];
};

/**
 * The shell exit code for a finished push.
 *
 * | Case | Exit |
 * |---|---|
 * | the user cancelled at the target-URL prompt (`null`) | 0 |
 * | `pushed` is false (nothing reached the platform: bad `--root`, empty draft, missing or blank `scripts/app.js` on a snapshot) | 1 |
 * | snapshot and `publishedSha` is `null` (the platform published nothing) | 1 |
 * | snapshot and `publishError` is set (the platform refused or failed the publish; the draft is still pushed) | 1 |
 * | snapshot and `liveVerified` is `false` (the published branch reads back at another commit) | 1 |
 * | `--fail-on-type-errors` and `typeCheckDiagnostics > 0` | 1 |
 * | everything else, including `liveVerified: null` (the read-back could not run; core warns) and kept platform-only files | 0 |
 *
 * A plain push is judged by `pushed` alone: it publishes nothing, so `publishedSha`, `publishError` and
 * `liveVerified` do not apply to it. Type errors in the script's own sources are warnings by default (the platform
 * runs the emitted JS un-type-checked, and valid JS often comes from imperfect TS); `failOnTypeErrors` makes them
 * fail. Syntax and emit errors never reach here: core throws and the push stops with exit 1.
 * @param result What core's push returned
 * @param snapshot Whether the push asked to publish (`--snapshot`, or `--message`, which implies it)
 * @param failOnTypeErrors Whether type errors fail the push (`--fail-on-type-errors`)
 * @returns `1` when the push must read as failed, `0` otherwise
 * @lastreviewed null
 */
export function pushExitCode(result: PushResult | null, snapshot: boolean, failOnTypeErrors = false): 0 | 1 {
  if (!result) {
    return 0;
  }
  if (!result.pushed) {
    return 1;
  }
  if (snapshot && (result.publishedSha === null || result.publishError !== null || result.liveVerified === false)) {
    return 1;
  }
  if (failOnTypeErrors && result.typeCheckDiagnostics !== null && result.typeCheckDiagnostics > 0) {
    return 1;
  }
  return 0;
}

/**
 * What a human is told when a script was switched from WebDAV to git.
 * @lastreviewed null
 */
export const SWITCHED_TO_GIT_NOTICE =
  "This script was switched from WebDAV to git publishing. The switch is one-way: its draft and snapshot " +
  "no longer accept WebDAV writes, and its history is now its git history.";

/**
 * The plain-language lines a human reads after a push: the commit, the published commit, a failed publish, and
 * (loudly) that the script was switched to git.
 * @param result What core's push returned
 * @param snapshot Whether the push asked to publish
 * @returns `info` lines (hidden under `--json`), `errors` (a failed publish) and `notices` (shown in every
 *   mode, because an agent must not miss a one-way change)
 * @lastreviewed null
 */
export function describePush(
  result: PushResult,
  snapshot: boolean
): { info: string[]; errors: string[]; notices: string[] } {
  const info: string[] = [];
  const errors: string[] = [];
  const notices: string[] = [];
  if (result.commitSha !== null) {
    info.push(`Draft commit: ${result.commitSha}`);
  }
  if (result.publishedSha !== null) {
    info.push(`Published commit: ${result.publishedSha}`);
  } else if (snapshot && result.publishError === null && result.pushed) {
    errors.push("The platform did not report a published commit; nothing was published.");
  }
  if (result.publishError !== null) {
    const refusal = result.publishRefusal;
    errors.push(
      refusal
        ? `${describePublishRefusal(refusal)}\nPlatform message: ${result.publishError}`
        : `The draft was pushed but the platform did not publish it: ${result.publishError}`
    );
  }
  if (result.switchedToGit) {
    notices.push(SWITCHED_TO_GIT_NOTICE);
  }
  return { info, errors, notices };
}

/**
 * The `--json` body for a push that returned a result.
 * @param result What core's push returned
 * @returns The result with `declinedOverwrites: []`
 * @lastreviewed null
 */
export function toPushJson(result: PushResult): PushJson {
  return { ...result, declinedOverwrites: [] };
}

/**
 * The `--json` body for a push that stopped at the overwrite confirmation (core threw
 * `Err.OverwriteDeclinedError`): nothing was uploaded, so every other field reads as "did not run".
 * @param paths The files whose overwrite was not confirmed (`err.paths`)
 * @param switchedToGit Whether the push had already switched the script to git before it stopped (the switch stands)
 * @returns A {@link PushJson} with `pushed: false` and the files in `declinedOverwrites`
 * @lastreviewed null
 */
export function declinedPushJson(paths: string[], switchedToGit = false): PushJson {
  return {
    pushed: false,
    commitSha: null,
    publishedSha: null,
    publishError: null,
    switchedToGit,
    typeCheckDiagnostics: null,
    liveVerified: null,
    liveMismatches: [],
    keptPlatformOnly: [],
    declinedOverwrites: [...paths],
    publishRefusal: null,
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
