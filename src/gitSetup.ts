import type {
  GitCredentialConfigEntry,
  GitCredentialHostStatus,
  GitCredentialKeptReset,
  GitCredentialRemoveResult,
  GitCredentialSetupResult,
  GitCredentialSetupStatus,
} from "@bluestep-systems/b6p-core";

// Terminal wording for core's git credential helper (`core.gitCredential`). Everything here is a
// pure function of what core returned: core decides what is set up and why, this only says it, and
// adds the "how to go on" lines core leaves to its consumers.

/** The command that sets git up, as the user types it. */
export const SETUP_GIT_COMMAND = "b6p auth setup-git";

/**
 * Lines for the user, split by channel: `info` for plain reports, `warn` for something the user
 * should act on.
 * @lastreviewed null
 */
export interface GitSetupLines {
  info: string[];
  warn: string[];
}

function list(items: readonly string[]): string {
  return items.join(", ");
}

function quoted(items: readonly string[]): string {
  return items.map((i) => `\`${i}\``).join(", ");
}

function entryText(entry: GitCredentialConfigEntry): string {
  const where = entry.file === null ? "on the command line" : `in ${entry.file}`;
  return `\`${entry.key} = ${entry.value}\` ${where}`;
}

const NO_HOSTS =
  "There is no host for b6p to answer git for yet: the gateway URL is not https, and no script pull has been recorded.";

/**
 * Why one host is not set up after setup: the other helpers git asks and the entries responsible.
 * Setup never moves or removes the user's own entries, so this says what to change.
 * @lastreviewed null
 */
function notSetUpLine(host: GitCredentialHostStatus): string {
  const reason =
    host.alsoAsked.length > 0
      ? `git also asks ${quoted(host.alsoAsked)}, which could see or keep the token`
      : "a later entry stops git from asking b6p";
  const entries = host.others.length > 0 ? ` Because of ${host.others.map(entryText).join("; ")}.` : "";
  return (
    `${host.host} is not fully set up: ${reason}.${entries} b6p never moves or removes your own entries: ` +
    `move ${host.others.length === 1 ? "it" : "them"} before b6p's [credential "https://${host.host}"] section, or remove ${host.others.length === 1 ? "it" : "them"}.`
  );
}

/**
 * Why a reset b6p wrote was left behind, in plain words.
 * @lastreviewed null
 */
export function keptResetLine(kept: GitCredentialKeptReset): string {
  const why =
    kept.reason === "shared-key"
      ? "that key has other empty values too, and git config cannot remove only b6p's"
      : "an earlier setup or removal was interrupted, so b6p cannot tell which empty value is its own";
  return (
    `Left an empty \`helper =\` that b6p wrote for ${kept.url} in ${kept.file}: ${why}. ` +
    "It only stops earlier helpers answering for that host; remove it by hand if you no longer want it."
  );
}

/**
 * What `b6p auth setup-git` says when there is nothing to set up.
 * @lastreviewed null
 */
export function describeNoHosts(): GitSetupLines {
  return { info: [NO_HOSTS], warn: [] };
}

/**
 * What `b6p auth setup-git` says about a finished setup.
 * @param result What `core.gitCredential.setupGit` returned
 * @param file The git config file written, or `null` when nothing was written
 * @lastreviewed null
 */
export function describeSetup(result: GitCredentialSetupResult, file: string | null): GitSetupLines {
  const info: string[] = [];
  const warn: string[] = [];
  if (result.hosts.length === 0) {
    return describeNoHosts();
  }
  if (result.added.length > 0) {
    info.push(`Set git to use b6p's token for ${list(result.added)}${file === null ? "" : `, in ${file}`}.`);
  }
  if (result.alreadyConfigured.length > 0) {
    info.push(
      result.added.length === 0
        ? `git already uses b6p's token for ${list(result.alreadyConfigured)}; nothing changed.`
        : `Already set up: ${list(result.alreadyConfigured)}.`
    );
  }
  for (const host of result.hosts) {
    if (!host.configured) {
      warn.push(notSetUpLine(host));
    }
  }
  for (const kept of result.keptResets) {
    info.push(keptResetLine(kept));
  }
  const allSet = result.hosts.every((h) => h.configured);
  if (allSet && result.otherHelpers.length > 0) {
    info.push(
      `Your other credential helpers (${quoted(result.otherHelpers)}) are left as they are; for these hosts b6p's ` +
        "empty `helper =` comes first, so git does not ask them."
    );
  }
  if (result.hosts.some((h) => h.configured)) {
    info.push(
      "Plain git pull and git push now work in knowledge-base clones and script drafts. A git push to a draft " +
        "does not build or publish it; that still takes `b6p script push`."
    );
    info.push(`After a first script pull from another tenant, run \`${SETUP_GIT_COMMAND}\` again.`);
  }
  return { info, warn };
}

/**
 * What `b6p auth setup-git --remove` says.
 * @lastreviewed null
 */
export function describeRemoval(result: GitCredentialRemoveResult): GitSetupLines {
  const info: string[] = [
    result.removed.length > 0
      ? `Removed b6p's git credential entries for ${list(result.removed)}.`
      : "b6p had no git credential entries to remove.",
  ];
  for (const kept of result.keptResets) {
    info.push(keptResetLine(kept));
  }
  return { info, warn: [] };
}

/**
 * The `git:` line of `b6p auth status`.
 * @param status What `core.gitCredential.setupStatus` returned, or the message of the error it threw
 * @lastreviewed null
 */
export function gitStatusLine(status: GitCredentialSetupStatus | { error: string }): string {
  if ("error" in status) {
    return `git: cannot check (${status.error})`;
  }
  if (status.hosts.length === 0) {
    return "git: no host for b6p to answer yet (the gateway URL is not https, and no script pull has been recorded).";
  }
  if (status.configured) {
    return `git: set up for ${list(status.hosts.map((h) => h.host))}.`;
  }
  const missing = status.hosts.filter((h) => !h.configured);
  const asked = [...new Set(missing.flatMap((h) => h.alsoAsked))];
  const also = asked.length > 0 ? ` (git also asks ${quoted(asked)})` : "";
  return `git: not set up for ${list(missing.map((h) => h.host))}${also}; run \`${SETUP_GIT_COMMAND}\`.`;
}

/**
 * The one-line hint after a pull, or `null` when git there already asks b6p alone (or the clone's
 * host is not one b6p answers for).
 * @param status What `core.gitCredential.cloneStatus` returned for the clone
 * @lastreviewed null
 */
export function cloneHint(status: GitCredentialHostStatus | null): string | null {
  if (status === null || status.configured) {
    return null;
  }
  return status.alsoAsked.length > 0
    ? `git here also asks ${quoted(status.alsoAsked)} for ${status.host}; run \`${SETUP_GIT_COMMAND}\` to see why.`
    : `To let plain git pull and git push here use your b6p token, run \`${SETUP_GIT_COMMAND}\`.`;
}

/**
 * The one-line hint after a script pull, read from the status where the workspace is, or `null`
 * when every host b6p answers for is set up. Core's script pull does not report the draft's
 * folder, so the hint covers every host rather than the one clone.
 * @lastreviewed null
 */
export function statusHint(status: GitCredentialSetupStatus): string | null {
  const missing = status.hosts.filter((h) => !h.configured);
  if (missing.length === 0) {
    return null;
  }
  return `To let plain git pull and git push use your b6p token for ${list(missing.map((h) => h.host))}, run \`${SETUP_GIT_COMMAND}\`.`;
}

/**
 * What to say for a `GitCredentialSetupError`: core's message, plus what to do when the fix is
 * clear from it.
 * @lastreviewed null
 */
export function describeGitSetupError(message: string): string {
  if (/ is older than /.test(message)) {
    return `${message} Update git, then run the command again.`;
  }
  if (/could not be run/.test(message)) {
    return `${message} Install git, then run the command again.`;
  }
  return message;
}
