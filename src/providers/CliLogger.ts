import type { Logger } from "@bluestep-systems/b6p-core";
import type { ActivityPauser } from "./CliPrompt";

export class CliLogger implements Logger {
  private readonly verbose: boolean;
  private pauser: ActivityPauser | null = null;
  /**
   * Every line written by {@link error}, so a caller can tell an error was already shown.
   * @lastreviewed null
   */
  private readonly errorLines: string[] = [];

  constructor(opts: { verbose?: boolean } = {}) {
    this.verbose = opts.verbose ?? false;
  }

  setActivityPauser(pauser: ActivityPauser | null): void {
    this.pauser = pauser;
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
    const line = args.map(String).join(" ");
    this.errorLines.push(line);
    this.write(`[ERROR] ${line}\n`);
  }

  /**
   * Whether `message` was already printed as part of an `[ERROR]` line.
   *
   * Core logs some failures and then rethrows them: a refused upload is logged as
   * `Failed to push <file>: <details>` and the same `Err.FileSendError` then reaches the CLI.
   * Printing the thrown message again shows the details twice.
   * @param message The thrown error's message
   * @returns True when a logged error line contains it; always false for an empty message
   * @lastreviewed null
   */
  hasReported(message: string): boolean {
    return message.length > 0 && this.errorLines.some((line) => line.includes(message));
  }

  debug(...args: unknown[]): void {
    if (this.verbose) {
      this.write(`[DEBUG] ${args.map(String).join(" ")}\n`);
    }
  }
}
