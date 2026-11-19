import * as path from "node:path";

/**
 * The environment for a CLI run with a throwaway home: `~/.b6p` (the stored token and settings)
 * and every git config git would read (`b6p auth status`, `auth set` and the pulls read it; `auth
 * setup-git` writes it) live under `home`, so a test never reads or touches the real user's.
 * @param home A temporary folder
 * @param extra Variables to add or override (a `PATH` with a stand-in `b6p` or `git`, say)
 */
export function isolatedEnv(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
    ...extra,
  };
}
