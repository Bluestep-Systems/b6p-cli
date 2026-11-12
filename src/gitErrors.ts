// The git-mode errors core throws from push and pull, as CLI messages that say what to do next.

import {
  GitStagedChangesError,
  GitSwitchDeclinedError,
  GitSymlinkError,
  GitWrongBranchError,
} from "@bluestep-systems/b6p-core";

/**
 * Text for stderr when `e` is one of core's git-mode refusals, or `undefined` for any other error.
 * Every one of them means nothing was changed; the caller exits `1`.
 * @param e Anything thrown by a push or pull
 * @returns The message with the fix spelled out, or `undefined`
 * @lastreviewed null
 */
export function describeGitError(e: unknown): string | undefined {
  if (!(e instanceof Error)) {
    return undefined;
  }
  if (e instanceof GitSwitchDeclinedError) {
    return (
      `${e.message}. Nothing was changed.\n` +
      "Switching is one-way: afterwards the script's draft and snapshot refuse WebDAV writes. " +
      "To switch it, run the same command with --enable-git. --yes never switches, because its answer " +
      "to the question is Cancel."
    );
  }
  if (e instanceof GitWrongBranchError) {
    return (
      `${e.message}.\n` +
      'Switch the draft folder back with: git -C <script>/draft checkout draft  (or "git switch draft"), ' +
      "then push again. Commits on the other branch are not lost; merge them into draft if you want them pushed."
    );
  }
  if (e instanceof GitStagedChangesError) {
    return (
      `${e.message}\n` +
      "Commit them (git -C <script>/draft commit), or unstage them (git -C <script>/draft restore --staged .) " +
      "after saving what you need, then pull again."
    );
  }
  if (e instanceof GitSymlinkError) {
    return (
      "Pull refused: incoming files would be written through a symbolic link that leaves the draft folder " +
      `(nothing was changed)\n\n${e.paths.join("\n")}\n` +
      "Remove or replace those symbolic links with real folders inside the draft folder, then pull again."
    );
  }
  return undefined;
}
