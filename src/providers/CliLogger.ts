import type { Logger } from "@bluestep-systems/b6p-core";
import type { ActivityPauser } from "./CliPrompt";
import type { FailureTracker } from "../exit";

export class CliLogger implements Logger {
  private readonly verbose: boolean;
  private pauser: ActivityPauser | null = null;
  private failures: FailureTracker | null = null;

  constructor(opts: { verbose?: boolean } = {}) {
    this.verbose = opts.verbose ?? false;
  }

  setActivityPauser(pauser: ActivityPauser | null): void {
    this.pauser = pauser;
  }

  /**
   * Attach the tracker that decides this invocation's exit code. See
   * {@link FailureTracker} for why `error` counts and `warn` does not.
   * @lastreviewed null
   */
  setFailureTracker(failures: FailureTracker | null): void {
    this.failures = failures;
  }

  private write(line: string): void {
    this.pauser?.pause();
    process.stderr.write(line);
    this.pauser?.resume();
  }

  info(...args: unknown[]): void {
    if (this.verbose) {
      this.write(`[INFO] ${args.map(String).join(" ")}\n`);
    }
  }

  warn(...args: unknown[]): void {
    this.write(`[WARN] ${args.map(String).join(" ")}\n`);
  }

  error(...args: unknown[]): void {
    // Record before writing: the count must not depend on verbosity or on the
    // write succeeding, since it is what the shell sees as the exit code.
    this.failures?.record();
    this.write(`[ERROR] ${args.map(String).join(" ")}\n`);
  }

  debug(...args: unknown[]): void {
    if (this.verbose) {
      this.write(`[DEBUG] ${args.map(String).join(" ")}\n`);
    }
  }
}
