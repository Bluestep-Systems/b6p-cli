import type { ILogger } from '@bluestep-systems/b6p-core';
import type { ActivityPauser } from './CliPrompt';

export class CliLogger implements ILogger {
  private readonly verbose: boolean;
  private pauser: ActivityPauser | null = null;

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
      this.write(`[INFO] ${args.map(String).join(' ')}\n`);
    }
  }

  warn(...args: unknown[]): void {
    this.write(`[WARN] ${args.map(String).join(' ')}\n`);
  }

  error(...args: unknown[]): void {
    this.write(`[ERROR] ${args.map(String).join(' ')}\n`);
  }

  debug(...args: unknown[]): void {
    if (this.verbose) {
      this.write(`[DEBUG] ${args.map(String).join(' ')}\n`);
    }
  }
}
