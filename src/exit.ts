/** Process exit code for a command that completed without reporting an error. */
export const EXIT_SUCCESS = 0;

/**
 * Process exit code for a command that failed.
 *
 * One code for every failure on purpose. Commander already exits `1` for usage
 * errors (unknown command, unknown flag), so introducing a second code here
 * would mean callers had to distinguish "the CLI rejected your arguments" from
 * "the operation failed" — a distinction no caller has asked for, and one that
 * would be a breaking change to walk back.
 */
export const EXIT_FAILURE = 1;

/** Conventional exit code for a process terminated by SIGINT (128 + 2). */
export const EXIT_SIGINT = 130;

/**
 * Records failures that were *reported* rather than thrown.
 *
 * The core layer very rarely throws. It reports a failed operation through
 * `Prompt.error` and then returns normally, which left the CLI exiting `0` from
 * commands that plainly did not work — `b6p script deploy` with an unreadable
 * config printed `ERROR: Config file not found` and reported success to the
 * shell. For a CLI whose whole purpose is unattended use, that is the difference
 * between a red pipeline and a silently broken one.
 *
 * **Only `Prompt.error` is counted — `Logger.error` is not.** That distinction is
 * load-bearing and was learned the hard way. `Logger` is a diagnostic channel and
 * core writes recoverable conditions to it: `ScriptRoot.modifyGitIgnore` reports a
 * missing `.gitignore` via `logger.error`, then creates the file and continues
 * normally. Since `ScriptFile.download` consults `.gitignore` before every file,
 * counting the logger made the *first* pull of any script exit `1` while the
 * second exited `0` — a non-deterministic exit code, which is worse than the
 * always-zero bug it replaced. `Prompt` is the user-facing channel and every core
 * call to `Prompt.error` aborts the operation, so it is the signal to trust.
 *
 * Known gap, and it needs a core fix rather than a workaround here:
 * `ScriptService.deploy` catches each target's failure into `logger.error`, then
 * prints "Deploy complete!". A deploy in which every target failed therefore still
 * exits `0`. The CLI cannot tell that apart from a recoverable log line.
 *
 * Counting is deliberately independent of whether the message was *printed*:
 * `--quiet` and `--json` change what the user sees, never what the shell is told.
 * @lastreviewed null
 */
export class FailureTracker {
  private readonly reported: string[] = [];

  /**
   * @param onFailure Invoked on every recorded failure. Defaults to setting
   *   `process.exitCode`, which is done **eagerly** rather than during teardown:
   *   an action whose promise never settles (a prompt that reaches EOF instead of
   *   answering) never reaches a `finally`, and a failure recorded before that
   *   point must still reach the shell. Injectable so tests need not mutate
   *   global process state.
   */
  constructor(
    private readonly onFailure: () => void = () => {
      process.exitCode = EXIT_FAILURE;
    }
  ) {}

  /** Note that a failure was reported, with the message shown to the user. */
  record(message: string): void {
    this.reported.push(message);
    this.onFailure();
  }

  /** The reported failure messages, in order. */
  get messages(): readonly string[] {
    return this.reported;
  }

  /** How many failures were reported during this invocation. */
  get count(): number {
    return this.reported.length;
  }

  /** Whether any failure was reported. */
  get failed(): boolean {
    return this.reported.length > 0;
  }
}
