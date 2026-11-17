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
import { pushProblem, SWITCHED_TO_GIT_NOTICE } from "./pushOutcome";
import { describePublishRefusal, publishRefusalOfError } from "./publishRefusal";

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
  const keyProblem = deployConfigKeyProblem(configText);
  if (keyProblem !== null) {
    return { ok: false, message: keyProblem };
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
 * The keys a deploy config may have, at the top level and in each `targets` entry. `failOnTypeErrors` is the CLI's;
 * the rest are core's `DeployConfig`.
 * @lastreviewed null
 */
export const DEPLOY_CONFIG_KEYS: readonly string[] = [
  "sourceRootPath",
  "targets",
  "author",
  "message",
  "enableGit",
  "failOnTypeErrors",
];

/**
 * The keys a `targets` entry may have.
 * @lastreviewed null
 */
export const DEPLOY_TARGET_KEYS: readonly string[] = ["url", "snapshot"];

/**
 * Why a deploy config's keys are refused, or `null` when they are all known (or the text is not a JSON object, which
 * core reports itself). Every unknown key is refused, at the top level and in each target, so a misspelt option never
 * goes unnoticed; `externallyBuilt` (removed in 1.0.0) says why it went.
 * @param configText The config file's text
 * @returns The message, or `null`
 * @lastreviewed null
 */
export function deployConfigKeyProblem(configText: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configText);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const unknown = Object.keys(parsed).filter((k) => !DEPLOY_CONFIG_KEYS.includes(k));
  const targets = (parsed as { targets?: unknown }).targets;
  if (Array.isArray(targets)) {
    targets.forEach((t: unknown, i) => {
      if (typeof t === "object" && t !== null && !Array.isArray(t)) {
        unknown.push(
          ...Object.keys(t)
            .filter((k) => !DEPLOY_TARGET_KEYS.includes(k))
            .map((k) => `targets[${i}].${k}`)
        );
      }
    });
  }
  if (unknown.length === 0) {
    return null;
  }
  const removed = unknown.some((k) => k === "externallyBuilt" || k.endsWith(".externallyBuilt"));
  return (
    `The deploy config has ${unknown.length === 1 ? "a key" : "keys"} b6p does not know: ${unknown.map((k) => `"${k}"`).join(", ")}. ` +
    "Nothing was pushed." +
    (removed
      ? ' "externallyBuilt" was removed in 1.0.0: the platform reads each script\'s own externallyBuilt flag, so delete the key.'
      : "") +
    ` Allowed: ${DEPLOY_CONFIG_KEYS.join(", ")}; in each target: ${DEPLOY_TARGET_KEYS.join(", ")}.`
  );
}

/**
 * Whether each target of a deploy config asked for a snapshot, by index (`false` for an unreadable config).
 * @param configText The config file's text, or `null`
 * @lastreviewed null
 */
export function deploySnapshots(configText: string | null): boolean[] {
  if (configText === null) {
    return [];
  }
  try {
    const targets = (JSON.parse(configText) as { targets?: unknown }).targets;
    return Array.isArray(targets)
      ? targets.map(
          (t: unknown) => typeof t === "object" && t !== null && (t as { snapshot?: unknown }).snapshot === true
        )
      : [];
  } catch {
    return [];
  }
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
 * What a deploy reads as, from core's per-target results: a line per target, and exit `1` when any target failed by
 * the same rule as a push ({@link pushProblem}: not pushed, a snapshot the server cannot take, a build that was not
 * asked for, failed, is of unknown outcome, did not publish or could not be taken in, a refused or failed publish, a
 * snapshot target that published nothing, or, with `failOnTypeErrors`, diagnostics in its own sources) or threw
 * (`error`). `null` (no results: the config file was missing, unreadable or invalid, which core has already reported)
 * is a failure too. Core prints each push's own errors and warnings; the lines here say which target and how to go on.
 * @param results What core's deploy returned
 * @param failOnTypeErrors Whether a target with diagnostics in its own sources fails the deploy (`--fail-on-type-errors`, or `failOnTypeErrors` in the config).
 * @param snapshots Whether each target (by index) asked for a snapshot, from the config file
 * @returns `info` lines (hidden under `--json`), `errors`, `notices` (how to go on, a switch to git; shown in every mode) and the exit code
 * @lastreviewed null
 */
export function describeDeploy(
  results: readonly DeployTargetResult[] | null,
  failOnTypeErrors = false,
  snapshots: readonly boolean[] = []
): {
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
  results.forEach((r, i) => {
    if (r.error !== undefined) {
      failed += 1;
      const refusal = publishRefusalOfError(r.error);
      errors.push(
        refusal
          ? `${r.target}: ${describePublishRefusal(refusal)}`
          : `${r.target}: failed: ${r.error instanceof Error ? r.error.message : String(r.error)}`
      );
    } else {
      const problem = pushProblem({ ...r, liveVerified: null }, snapshots[i] === true, failOnTypeErrors);
      if (problem !== null) {
        failed += 1;
        errors.push(`${r.target}: ${problem.message}`);
        if (problem.howTo) {
          notices.push(`${r.target}: To go on: ${problem.howTo}`);
        }
      } else {
        info.push(
          `${r.target}: pushed ${r.commitSha}` +
            (r.buildCommitSha !== null ? `, built ${r.buildCommitSha}` : "") +
            (r.publishedSha !== null ? `, published ${r.publishedSha}` : "")
        );
      }
    }
    if (r.switchedToGit) {
      notices.push(`${r.target}: ${SWITCHED_TO_GIT_NOTICE}`);
    }
  });
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

/**
 * Whether a deploy fails on type errors: the `--fail-on-type-errors` flag, else the config file's
 * `failOnTypeErrors: true`.
 * @param flag The command-line flag
 * @param configText The config file's text (`null` when unreadable)
 * @lastreviewed null
 */
export function deployFailsOnTypeErrors(flag: boolean | undefined, configText: string | null): boolean {
  if (flag === true) {
    return true;
  }
  if (configText === null) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(configText);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { failOnTypeErrors?: unknown }).failOnTypeErrors === true
    );
  } catch {
    return false;
  }
}
