import * as path from "path";
import { B6PCore } from "@bluestep-systems/b6p-core";
import { SharedFilePersistence } from "@bluestep-systems/b6p-core";
import { NodeFileSystem } from "./providers/NodeFileSystem";
import { CliPrompt } from "./providers/CliPrompt";
import { CliLogger } from "./providers/CliLogger";
import { CliProgress } from "./providers/CliProgress";
import { Spinner } from "./providers/Spinner";
import { WindowsRestartManagerLockDiagnoser } from "./lockDiagnoser/WindowsRestartManagerLockDiagnoser";
import { resolveTsLibDirs } from "./tsLibs";
import { migrateLegacyDotfiles } from "./migrate";
import { FailureTracker } from "./exit";

/**
 * The root-level flags every command honours. Declared as a `type` rather than an
 * `interface` on purpose: commander's `opts<T>()` constrains `T` to
 * `Record<string, any>`, and only type aliases pick up the implicit index
 * signature that satisfies it.
 * @lastreviewed null
 */
export type GlobalOpts = {
  yes?: boolean;
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
};

/**
 * A live CLI session: the constructed SDK plus the terminal adapters an action
 * needs to talk back to the user.
 * @lastreviewed null
 */
export interface CliContext {
  core: B6PCore;
  prompt: CliPrompt;
  spinner: Spinner;
  globalOpts: GlobalOpts;
  /**
   * Write `payload` to stdout as pretty JSON, but only under `--json`. Commands
   * that produce a result call this unconditionally; it is a no-op in human mode.
   * @lastreviewed null
   */
  emitJson(payload: unknown): void;
  /**
   * Report a failed operation: prints `ERROR: <message>` and makes the command
   * exit non-zero. Use this for a failure, not for a negative *answer* — see
   * {@link FailureTracker}.
   * @lastreviewed null
   */
  fail(message: string): void;
  /** Whether a failure has already been reported during this invocation. */
  readonly hasFailed: () => boolean;
}

/**
 * The GitHub repository consulted for CLI updates. This is the CLI's own repo:
 * `b6p-core` is a bundled devDependency with its own release cadence, and a user
 * running `b6p check-updates` is asking about the tool they installed.
 */
const UPDATE_REPO_OWNER = "Bluestep-Systems";
const UPDATE_REPO_NAME = "b6p-cli";

// Replaced at build time by esbuild's `define` with the package.json version.
declare const __B6P_VERSION__: string;

/**
 * The running CLI version. Read through a function so a test bundle that lacks
 * the esbuild `define` still loads instead of throwing on a missing global.
 * @lastreviewed null
 */
function getVersion(): string {
  return typeof __B6P_VERSION__ === "string" ? __B6P_VERSION__ : "0.0.0-dev";
}

/** Resolve a user-supplied path against the process working directory. */
export function resolve(p: string): string {
  return path.resolve(process.cwd(), p);
}

/**
 * Build the core SDK over the terminal providers, run `body`, and tear the
 * terminal back down.
 *
 * Every command action is wrapped in this. The teardown — disposing the SDK,
 * stopping the spinner, closing readline — must happen whether the body resolves
 * or throws, or the process hangs on an open handle; centralising it here is what
 * keeps the command modules free of `try`/`finally` boilerplate.
 *
 * It also settles the **exit code**. Core reports most failures through
 * `Prompt.error` and returns normally rather than throwing, so "did this work?"
 * cannot be answered by whether `body` resolved; a {@link FailureTracker} wired
 * into the prompt answers it instead. Thrown errors are handled by the top-level
 * catch in [index.ts](index.ts).
 * @param globalOpts Root-level flags, read from the program at action time.
 * @param body Receives the constructed context; its resolved value is returned.
 * @param initialSpinnerLabel First label shown while the SDK spins up.
 * @lastreviewed null
 */
export async function withCore<T>(
  globalOpts: GlobalOpts,
  body: (ctx: CliContext) => Promise<T>,
  initialSpinnerLabel = "Working…"
): Promise<T> {
  const version = getVersion();
  const prompt = new CliPrompt({ autoYes: globalOpts.yes, json: globalOpts.json });
  const logger = new CliLogger({ verbose: globalOpts.verbose });
  const progress = new CliProgress({ quiet: globalOpts.quiet || globalOpts.json });
  // Disable the spinner in JSON / quiet mode so stderr stays clean for consumers.
  const spinner = new Spinner(initialSpinnerLabel, {
    enabled: !globalOpts.json && !globalOpts.quiet && process.stderr.isTTY === true,
  });
  prompt.setActivityPauser(spinner);
  logger.setActivityPauser(spinner);
  progress.setActivityPauser(spinner);
  // Counts failures core reports but does not throw; drives the exit code. The
  // tracker sets process.exitCode as each failure is recorded rather than during
  // teardown, so a failure still reaches the shell if the action promise never
  // settles (a prompt that hits EOF instead of an answer).
  const failures = new FailureTracker();
  prompt.setFailureTracker(failures);

  // Keep the default `~/.b6p` config dir (undefined), but inject a Windows lock
  // diagnoser so a failed shared-state rename names the processes holding the
  // file. Best-effort and a no-op off Windows; see WindowsRestartManagerLockDiagnoser.
  const persistence = new SharedFilePersistence(undefined, new WindowsRestartManagerLockDiagnoser());
  await migrateLegacyDotfiles(persistence);
  const core = new B6PCore({
    fs: new NodeFileSystem(),
    persistence,
    prompt,
    logger,
    progress,
    // Resolve lib.*.d.ts for the core's bundled TypeScript compile (see tsLibs.ts).
    typescriptLibDirs: resolveTsLibDirs(),
    // Without this core leaves `updateService` null and `checkForUpdates()` can
    // only ever report "Update service is not configured". Points at THIS
    // repository — the CLI's own releases — not b6p-core's.
    updateServiceConfig: {
      currentVersion: version,
      repoOwner: UPDATE_REPO_OWNER,
      repoName: UPDATE_REPO_NAME,
      enabled: true,
    },
  });
  spinner.start();

  let emittedJson = false;
  const ctx: CliContext = {
    core,
    prompt,
    spinner,
    globalOpts,
    emitJson(payload: unknown): void {
      if (globalOpts.json) {
        emittedJson = true;
        process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      }
    },
    fail(message: string): void {
      prompt.error(message);
    },
    hasFailed: () => failures.failed,
  };

  try {
    return await body(ctx);
  } finally {
    // Disposes the session-cleanup timer and org cache. Without it the process
    // can stay alive on a pending handle, which matters now that failures set
    // `process.exitCode` and let Node exit on its own instead of calling
    // `process.exit()` (which would truncate a large `--json` payload mid-write).
    core.dispose();
    spinner.stop();
    prompt.close();
    // Give --json consumers a machine-readable failure. Without this stdout is
    // empty on error and the only description of what went wrong is an English
    // sentence on stderr. Suppressed when a success payload was already written,
    // so stdout never carries two JSON documents.
    if (globalOpts.json && failures.failed && !emittedJson) {
      process.stdout.write(JSON.stringify({ error: failures.messages[0], errors: failures.messages }, null, 2) + "\n");
    }
  }
}
