import { Err } from "@bluestep-systems/b6p-core";
import { AuthorFormatError, isMissingAuthorError, missingAuthorMessage } from "./author";
import { describeGitError } from "./gitErrors";
import { declinedPushJson, overwriteCommand, type PushJson, type ShellDialect } from "./pushOutcome";

/**
 * A push that stopped before anything was committed or uploaded, as the CLI reports it: always exit `1`.
 * @lastreviewed null
 */
export interface PushFailure {
  /**
   * The `ERROR:` line.
   * @lastreviewed null
   */
  message: string;
  /**
   * A follow-up with the command or step that goes on, when there is one.
   * @lastreviewed null
   */
  notice?: string;
  /**
   * The `--json` body: a push that did not run.
   * @lastreviewed null
   */
  json: PushJson;
}

/**
 * Turns what a push threw into a {@link PushFailure}, or `undefined` for an error the CLI has no special words for.
 * Covers: no author (or a malformed one), core's git refusals (a declined switch to git, a wrong branch checked out),
 * and a declined overwrite. Each call stands alone: a retry after a failure is a new push and is reported as one.
 * @param e Anything thrown by a push
 * @param args The push's arguments as given (`process.argv.slice(2)`), to print the retry command
 * @param dialect The shell the printed commands are written for
 * @lastreviewed null
 */
export function pushFailureOf(e: unknown, args: string[], dialect: ShellDialect): PushFailure | undefined {
  if (isMissingAuthorError(e)) {
    return { message: missingAuthorMessage(e.message), json: declinedPushJson([]) };
  }
  if (e instanceof AuthorFormatError) {
    return { message: e.message, json: declinedPushJson([]) };
  }
  const gitMessage = describeGitError(e);
  if (gitMessage !== undefined) {
    return { message: gitMessage, json: declinedPushJson([]) };
  }
  if (e instanceof Err.OverwriteDeclinedError) {
    const one = e.paths.length === 1;
    return {
      message: e.message,
      notice:
        `After checking ${one ? "it" : "them"}, overwrite ${one ? "it" : "them"} ` +
        `with your local ${one ? "file" : "files"} with:\n  ${overwriteCommand(args, e.paths, dialect)}`,
      json: declinedPushJson(e.paths),
    };
  }
  return undefined;
}
