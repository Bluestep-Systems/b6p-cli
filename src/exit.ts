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

/**
 * Counts failures that were *reported* rather than thrown.
 *
 * The core layer very rarely throws. It reports a failed operation through
 * `Prompt.error` / `Logger.error` and then returns normally, which left the CLI
 * exiting `0` from commands that plainly did not work — `b6p script deploy` with
 * an unreadable config printed `ERROR: Config file not found` and reported
 * success to the shell. For a CLI whose whole purpose is unattended use, that is
 * the difference between a red pipeline and a silently broken one.
 *
 * So the terminal adapters count what passes through their error channels, and
 * {@link withCore} turns a non-zero count into {@link EXIT_FAILURE}. Both `error`
 * channels are counted, and neither `warn` channel is:
 *
 * - Every `Prompt.error` call in core aborts the operation (each is immediately
 *   followed by a `return`), so it is an unambiguous failure signal.
 * - `Logger.error` is mostly paired with a `throw` — which would surface anyway —
 *   but it is the *only* signal in two places, the important one being the
 *   per-target `catch` in `ScriptService.deploy`. A deploy in which every target
 *   failed logs each one, prints "Deploy complete!", and would otherwise exit `0`.
 *
 * Counting is deliberately independent of whether the message was *printed*:
 * `--quiet` and `--json` change what the user sees, never what the shell is told.
 * @lastreviewed null
 */
export class FailureTracker {
  private failures = 0;

  /** Note that a failure was reported. */
  record(): void {
    this.failures += 1;
  }

  /** How many failures were reported during this invocation. */
  get count(): number {
    return this.failures;
  }

  /** Whether any failure was reported. */
  get failed(): boolean {
    return this.failures > 0;
  }
}
