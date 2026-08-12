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
import { migrateLegacyDotfiles, purgeLegacyBasicAuth } from "./migrate";

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
}

/** Resolve a user-supplied path against the process working directory. */
export function resolve(p: string): string {
  return path.resolve(process.cwd(), p);
}

/**
 * Build the core SDK over the terminal providers, run `body`, and tear the
 * terminal back down.
 *
 * Every command action is wrapped in this. The teardown — stopping the spinner
 * and closing readline — must happen whether the body resolves or throws, or the
 * process hangs on an open stdin handle; centralising it here is what keeps the
 * command modules free of `try`/`finally` boilerplate.
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

  // Keep the default `~/.b6p` config dir (undefined), but inject a Windows lock
  // diagnoser so a failed shared-state rename names the processes holding the
  // file. Best-effort and a no-op off Windows; see WindowsRestartManagerLockDiagnoser.
  const persistence = new SharedFilePersistence(undefined, new WindowsRestartManagerLockDiagnoser());
  await migrateLegacyDotfiles(persistence);
  await purgeLegacyBasicAuth(persistence);
  const core = new B6PCore({
    fs: new NodeFileSystem(),
    persistence,
    prompt,
    logger,
    progress,
    // Resolve lib.*.d.ts for the core's bundled TypeScript compile (see tsLibs.ts).
    typescriptLibDirs: resolveTsLibDirs(),
  });
  spinner.start();

  const ctx: CliContext = {
    core,
    prompt,
    spinner,
    globalOpts,
    emitJson(payload: unknown): void {
      if (globalOpts.json) {
        process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      }
    },
  };

  try {
    return await body(ctx);
  } finally {
    spinner.stop();
    prompt.close();
  }
}
