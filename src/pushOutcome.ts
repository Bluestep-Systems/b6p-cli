import type { PushResult } from "@bluestep-systems/b6p-core";

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
 * A push that uploaded nothing (bad `--root`, empty draft, a compiled `scripts/app.js` that is
 * missing or has no code) or a snapshot that shipped without a history entry must not report
 * success: that is what let a typo'd `--root` mark a deploy green. A live copy that still reads
 * back wrong after core's one re-send (`liveVerified: false`) is a broken publish (ClickUp
 * 86bbqnrtp). Core already clears `historyRecorded` in that case; it is checked on its own so the
 * reason stays explicit. A snapshot that shipped with type-check diagnostics also fails: the
 * platform runs the emitted JS un-type-checked, so the push was the only gate.
 *
 * Not failures: `null` (the user cancelled at the target-URL prompt), `liveVerified: null` (a copy
 * came back without a content hash and could not be compared; core warns on stderr, and failing
 * here would block every push if the platform's ETag format changed), and `typeCheckDiagnostics`
 * `null` (no compile ran) or `0`.
 * @param result What core's push returned
 * @returns `1` when the push must read as failed, `0` otherwise
 * @lastreviewed null
 */
export function pushExitCode(result: PushResult | null): 0 | 1 {
  if (!result) {
    return 0;
  }
  if (!result.pushed || !result.historyRecorded || result.liveVerified === false) {
    return 1;
  }
  if (result.typeCheckDiagnostics !== null && result.typeCheckDiagnostics > 0) {
    return 1;
  }
  return 0;
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
 * @returns A {@link PushJson} with `pushed: false` and the files in `declinedOverwrites`
 * @lastreviewed null
 */
export function declinedPushJson(paths: string[]): PushJson {
  return {
    pushed: false,
    historyRecorded: false,
    typeCheckDiagnostics: null,
    liveVerified: null,
    liveMismatches: [],
    keptPlatformOnly: [],
    declinedOverwrites: [...paths],
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
