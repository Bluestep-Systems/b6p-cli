import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The top folder of the git clone that contains `start`: the nearest folder at or above it that holds a
 * `.git` (a folder, or the file a worktree leaves). Core's `kb push` looks for `.git` in exactly the
 * folder it is given and never walks up, so `b6p kb push` run from `kb/docs/` would otherwise fail with
 * "not a clone". When no `.git` is found anywhere above, `start` is returned unchanged and core reports
 * the problem for the folder the user named.
 * @param start An absolute folder.
 * @lastreviewed null
 */
export function findCloneRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(start);
    }
    dir = parent;
  }
}
