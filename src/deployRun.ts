// What `b6p deploy` does around core: settle the author and fail early when none resolves, and read core's per-target results.
import * as fs from "fs";
import type { DeployTargetResult } from "@bluestep-systems/b6p-core";
import * as path from "path";
import {
  AuthorFormatError,
  isMissingAuthorError,
  missingAuthorMessage,
  planDeployAuthor,
  type DeployAuthorPlan,
} from "./author";
import { SWITCHED_TO_GIT_NOTICE } from "./pushOutcome";

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
 * What a deploy reads as, from core's per-target results: a line per target, and exit `1` when any target failed
 * (`error`), had its publish refused or failed (`publishError`), or was not pushed. `null` (no results: the config file
 * was missing, unreadable or invalid, which core has already reported) is a failure too.
 * @param results What core's deploy returned
 * @returns `info` lines (hidden under `--json`), `errors`, `notices` (a switch to git, shown in every mode) and the exit code
 * @lastreviewed null
 */
export function describeDeploy(results: readonly DeployTargetResult[] | null): {
  info: string[];
  errors: string[];
  notices: string[];
  exitCode: 0 | 1;
} {
  const info: string[] = [];
  const errors: string[] = [];
  const notices: string[] = [];
  if (results === null) {
    return { info, errors: ["Deploy did not run: see the error above."], notices, exitCode: 1 };
  }
  let failed = 0;
  for (const r of results) {
    if (r.error !== undefined) {
      failed += 1;
      errors.push(`${r.target}: failed: ${r.error instanceof Error ? r.error.message : String(r.error)}`);
    } else if (!r.pushed) {
      failed += 1;
      errors.push(`${r.target}: nothing was pushed`);
    } else if (r.publishError !== null) {
      failed += 1;
      errors.push(`${r.target}: pushed (commit ${r.commitSha}) but not published: ${r.publishError}`);
    } else {
      info.push(`${r.target}: pushed ${r.commitSha}${r.publishedSha !== null ? `, published ${r.publishedSha}` : ""}`);
    }
    if (r.switchedToGit) {
      notices.push(`${r.target}: ${SWITCHED_TO_GIT_NOTICE}`);
    }
  }
  info.push(
    failed === 0 ? "Deploy complete." : `Deploy finished with ${failed} of ${results.length} target(s) failed.`
  );
  return { info, errors, notices, exitCode: failed === 0 ? 0 : 1 };
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
