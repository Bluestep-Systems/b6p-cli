import { Err, gitConfigRunner, type GitCredentialSetupStatus } from "@bluestep-systems/b6p-core";
import type { CliContext } from "./context";
import {
  SETUP_GIT_COMMAND,
  cloneHint,
  describeGitSetupError,
  describeNoHosts,
  describeRemoval,
  describeSetup,
  statusHint,
  type GitSetupLines,
} from "./gitSetup";

function say(ctx: CliContext, lines: GitSetupLines): void {
  for (const line of lines.info) {
    ctx.prompt.info(line);
  }
  for (const line of lines.warn) {
    ctx.prompt.warn(line);
  }
}

/**
 * Run `body`, turning core's `GitCredentialSetupError` (git missing or too old, a config file that
 * cannot be read, locked or written) into a reported failure, so the command exits 1.
 * @lastreviewed null
 */
async function runGitSetup(ctx: CliContext, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (err) {
    if (err instanceof Err.GitCredentialSetupError) {
      ctx.fail(describeGitSetupError(err.message));
      return;
    }
    throw err;
  }
}

/**
 * `b6p auth setup-git`: check, then make b6p the helper git asks for every host it answers for, in
 * the user's global git config, and say what was written and what is still in the way.
 * @lastreviewed null
 */
export async function runSetupGit(ctx: CliContext): Promise<void> {
  await runGitSetup(ctx, async () => {
    const cwd = process.cwd();
    const status = await ctx.core.gitCredential.setupStatus({ cwd });
    if (status.hosts.length === 0) {
      say(ctx, describeNoHosts());
      ctx.emitJson({
        added: [],
        alreadyConfigured: [],
        hosts: [],
        otherHelpers: status.otherHelpers,
        keptResets: [],
        scope: status.scope,
        file: null,
      });
      return;
    }
    const result = await ctx.core.gitCredential.setupGit({ cwd });
    // The file setup wrote, as git itself reports it; core's result names the hosts but not the file.
    const file = result.added.length > 0 ? await gitConfigRunner().globalFile() : null;
    ctx.spinner.stop();
    say(ctx, describeSetup(result, file));
    ctx.emitJson({ ...result, file });
  });
}

/**
 * `b6p auth setup-git --remove`: take b6p's entries out of the user's global git config.
 * @lastreviewed null
 */
export async function runRemoveGit(ctx: CliContext): Promise<void> {
  await runGitSetup(ctx, async () => {
    const result = await ctx.core.gitCredential.removeGit();
    ctx.spinner.stop();
    say(ctx, describeRemoval(result));
    ctx.emitJson(result);
  });
}

/**
 * What {@link offerGitSetup} needs, injectable for tests.
 * @lastreviewed null
 */
export interface GitSetupOffer {
  /** Whether a person can answer a question: stdin is a TTY, and neither `--yes` nor `--json` was given. */
  interactive: boolean;
  status(): Promise<GitCredentialSetupStatus>;
  confirm(message: string, options: string[]): Promise<string | undefined>;
  info(message: string): void;
  setup(): Promise<void>;
}

export const OFFER_QUESTION = "Set up git to use this token for git pull and git push? (runs `b6p auth setup-git`)";
export const OFFER_HINT = `To let plain git pull and git push use this token, run \`${SETUP_GIT_COMMAND}\`.`;

/**
 * After `b6p auth set` stores a token: when git is not set up for every host b6p answers for, ask
 * whether to set it up now (default yes), or, when nobody can answer, print a one-line hint.
 * Nothing is said when git is set up already, when there is no host yet, or when git cannot be
 * checked (that is `b6p auth status`'s and `b6p auth setup-git`'s to report).
 * @lastreviewed null
 */
export async function offerGitSetup(offer: GitSetupOffer): Promise<void> {
  let status: GitCredentialSetupStatus;
  try {
    status = await offer.status();
  } catch {
    // The token is stored; a git that cannot be checked must not turn that into a failure.
    return;
  }
  if (status.hosts.length === 0 || status.configured) {
    return;
  }
  if (!offer.interactive) {
    offer.info(OFFER_HINT);
    return;
  }
  if ((await offer.confirm(OFFER_QUESTION, ["Yes", "No"])) === "Yes") {
    await offer.setup();
  }
}

/**
 * The hint after a pull. Never fails the pull: any error is a debug line.
 * @lastreviewed null
 */
export async function hintAfterPull(
  report: { info(message: string): void; debug(message: string): void },
  check: () => Promise<string | null>
): Promise<void> {
  try {
    const hint = await check();
    if (hint !== null) {
      report.info(hint);
    }
  } catch (err) {
    report.debug(`git credential check after the pull skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function pullReport(ctx: CliContext): { info(message: string): void; debug(message: string): void } {
  return { info: (m) => ctx.prompt.info(m), debug: (m) => ctx.logger.debug(m) };
}

/**
 * The hint for a knowledge-base clone, from `cloneStatus` on it.
 * @lastreviewed null
 */
export function kbPullHint(ctx: CliContext, dir: string): Promise<void> {
  return hintAfterPull(pullReport(ctx), async () => cloneHint(await ctx.core.gitCredential.cloneStatus(dir)));
}

/**
 * The hint after a script pull, from the status where the workspace is (core's pull result does
 * not name the draft's folder).
 * @lastreviewed null
 */
export function scriptPullHint(ctx: CliContext, workspace: string): Promise<void> {
  return hintAfterPull(pullReport(ctx), async () =>
    statusHint(await ctx.core.gitCredential.setupStatus({ cwd: workspace }))
  );
}
