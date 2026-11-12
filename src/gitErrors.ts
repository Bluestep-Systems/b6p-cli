// The git-mode errors core throws from push and pull, as CLI messages that say what to do next.
// Matched by `name`, not class: core exports only some of them, and the name is part of each error's contract.

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
  const paths = (e as Error & { paths?: unknown }).paths;
  switch (e.name) {
    case "GitSwitchDeclinedError":
      return (
        `${e.message}. Nothing was changed.\n` +
        "Switching is one-way: afterwards the script's draft and snapshot refuse WebDAV writes. " +
        "To switch it, run the same command with --enable-git. --yes never switches, because its answer " +
        "to the question is Cancel."
      );
    case "GitWrongBranchError":
      return (
        `${e.message}.\n` +
        'Switch the draft folder back with: git -C <script>/draft checkout draft  (or "git switch draft"), ' +
        "then push again. Commits on the other branch are not lost; merge them into draft if you want them pushed."
      );
    case "GitStagedChangesError":
      return (
        `${e.message}\n` +
        "Commit them (git -C <script>/draft commit), or unstage them (git -C <script>/draft restore --staged .) " +
        "after saving what you need, then pull again."
      );
    case "GitSymlinkError": {
      const list = Array.isArray(paths) ? `\n\n${paths.join("\n")}` : "";
      return (
        `Pull refused: incoming files would be written through a symbolic link that leaves the draft folder ` +
        `(nothing was changed)${list}\n` +
        "Remove or replace those symbolic links with real folders inside the draft folder, then pull again."
      );
    }
    default:
      return undefined;
  }
}
