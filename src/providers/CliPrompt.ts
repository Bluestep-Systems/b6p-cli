import * as readline from 'readline/promises';
import type { IPrompt } from '@bluestep-systems/b6p-core';

/**
 * CLI implementation of the prompt provider.
 *
 * When `autoYes` is true, confirmations return the first option automatically
 * and input boxes return their default value (or throw if none). This enables
 * non-interactive usage with `--yes`.
 */
export interface ActivityPauser {
  pause(): void;
  resume(): void;
}

export class CliPrompt implements IPrompt {
  private rl: readline.Interface | null = null;
  private readonly autoYes: boolean;
  private readonly jsonMode: boolean;
  private pauser: ActivityPauser | null = null;

  constructor(opts: { autoYes?: boolean; json?: boolean } = {}) {
    this.autoYes = opts.autoYes ?? false;
    this.jsonMode = opts.json ?? false;
  }

  /** Attach a background activity indicator (e.g. Spinner) that should be
   *  paused while the prompt reads from stdin or writes user-facing text. */
  setActivityPauser(pauser: ActivityPauser | null): void {
    this.pauser = pauser;
  }

  private async aroundIO<T>(fn: () => Promise<T>): Promise<T> {
    this.pauser?.pause();
    try {
      return await fn();
    } finally {
      this.pauser?.resume();
    }
  }

  private getRL(): readline.Interface {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr, // keep stdout clean for --json
      });
    }
    return this.rl;
  }

  async inputBox(options: { prompt: string; password?: boolean; value?: string }): Promise<string | undefined> {
    if (this.autoYes && options.value !== undefined) {
      return options.value;
    }
    return this.aroundIO(async () => {
      const answer = await this.getRL().question(`${options.prompt}: `);
      return answer || undefined;
    });
  }

  async confirm(message: string, options: string[]): Promise<string | undefined> {
    if (this.autoYes) {
      return options[0];
    }
    return this.aroundIO(async () => {
      const optStr = options.map((o, i) => i === 0 ? `[${o}]` : o).join(' / ');
      const answer = await this.getRL().question(`${message}\n${optStr}: `);
      if (!answer) {
        return options[0];
      }
      return options.find(o => o.toLowerCase() === answer.toLowerCase());
    });
  }

  info(message: string): void {
    if (!this.jsonMode) {
      this.pauser?.pause();
      process.stderr.write(`${message}\n`);
      this.pauser?.resume();
    }
  }

  async popup(message: string): Promise<void> {
    this.info(message);
  }

  warn(message: string): void {
    this.pauser?.pause();
    process.stderr.write(`WARNING: ${message}\n`);
    this.pauser?.resume();
  }

  error(message: string): void {
    this.pauser?.pause();
    process.stderr.write(`ERROR: ${message}\n`);
    this.pauser?.resume();
  }

  /** Close the readline interface. Call when the CLI is done. */
  close(): void {
    this.rl?.close();
    this.rl = null;
  }
}
