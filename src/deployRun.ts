// What `b6p deploy` does before it calls core: settle the author and fail early when none resolves.
//
// Core's deploy swallows a per-target failure (it logs it, goes on, and prints "Deploy complete!"), and returns no
// per-target results. So the CLI checks the author first, and afterwards counts the errors core reported.
import * as fs from "fs";
import * as path from "path";
import {
  AuthorFormatError,
  isMissingAuthorError,
  missingAuthorMessage,
  planDeployAuthor,
  type DeployAuthorPlan,
} from "./author";

/**
 * What to do with a deploy config.
 * @lastreviewed null
 */
export type DeployPlan = { ok: true; configText: string | null } | { ok: false; message: string };

/**
 * Settles a deploy's author before core runs.
 * @param configText The config file's text, or `null` when it could not be read (core reports that itself)
 * @param flagText The raw `--author`, if given
 * @param settingValue The stored `author` setting, unparsed
 * @param resolveIdentity Core's `resolveGitIdentity` bound to a folder: throws when git config and the environment
 *   have no author; only called when neither the flag, the file nor the setting gave one
 * @returns `ok` with the text to give core (`null`: the file as is), or the message to print before exiting `1`
 * @lastreviewed null
 */
export async function planDeploy(
  configText: string | null,
  flagText: string | undefined,
  settingValue: unknown,
  resolveIdentity: (dir: string) => Promise<unknown>
): Promise<DeployPlan> {
  if (configText === null) {
    return { ok: true, configText: null };
  }
  let plan: DeployAuthorPlan;
  try {
    plan = planDeployAuthor(configText, flagText, settingValue);
  } catch (e) {
    if (e instanceof AuthorFormatError) {
      return { ok: false, message: e.message };
    }
    throw e;
  }
  if (plan.author === undefined && plan.sourceRootPath !== undefined) {
    try {
      await resolveIdentity(nearestExistingDir(path.join(path.resolve(plan.sourceRootPath), "draft")));
    } catch (e) {
      if (isMissingAuthorError(e)) {
        return { ok: false, message: missingAuthorMessage(e.message) };
      }
      throw e;
    }
  }
  return { ok: true, configText: plan.text };
}

/**
 * The folder itself, or its nearest ancestor that exists (git cannot run in a folder that is not there).
 * @lastreviewed null
 */
export function nearestExistingDir(dir: string): string {
  let current = dir;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return current;
}

/**
 * The exit code of a deploy: `1` when core reported any error while it ran (a target that failed, a refused or failed
 * publish), `0` otherwise.
 * @param errorsReported Errors core raised through the logger and the prompt during the deploy
 * @lastreviewed null
 */
export function deployExitCode(errorsReported: number): 0 | 1 {
  return errorsReported > 0 ? 1 : 0;
}

/**
 * Removes the temporary deploy config's folder. A failure only warns: it must not replace the deploy's own error or turn
 * a good deploy into a failed one.
 * @param dir The folder
 * @param remove Deletes a folder (`fs.rm` with recursive and force)
 * @param warn Prints a warning
 * @lastreviewed null
 */
export async function removeTempDir(
  dir: string,
  remove: (dir: string) => Promise<void>,
  warn: (message: string) => void
): Promise<void> {
  try {
    await remove(dir);
  } catch (e) {
    warn(`Could not remove the temporary deploy config in ${dir}: ${e instanceof Error ? e.message : e}`);
  }
}
