import type { IProgress, ProgressTask } from '@bluestep-systems/b6p-core';
import type { ActivityPauser } from './CliPrompt';

export class CliProgress implements IProgress {
  private readonly quiet: boolean;
  private pauser: ActivityPauser | null = null;

  constructor(opts: { quiet?: boolean } = {}) {
    this.quiet = opts.quiet ?? false;
  }

  setActivityPauser(pauser: ActivityPauser | null): void {
    this.pauser = pauser;
  }

  async withProgress<T>(
    tasks: ProgressTask<T>[],
    options: { title: string; showItemCount?: boolean; cleanupMessage?: string }
  ): Promise<T[]> {
    const total = tasks.length;
    let completed = 0;
    const results: T[] = [];

    // Own stderr for the duration of the progress block so the background
    // spinner doesn't fight our \r writes.
    this.pauser?.pause();
    if (!this.quiet) {
      process.stderr.write(`${options.title}\n`);
    }

    for (const task of tasks) {
      const result = await task.execute();
      results.push(result);
      completed++;

      if (!this.quiet) {
        const pct = Math.round((completed / total) * 100);
        const desc = task.description ? ` - ${task.description}` : '';
        process.stderr.write(`\r  [${completed}/${total}] ${pct}%${desc}`);
      }
    }

    if (!this.quiet) {
      process.stderr.write('\n');
      if (options.cleanupMessage) {
        process.stderr.write(`  ${options.cleanupMessage}\n`);
      }
    }
    this.pauser?.resume();

    return results;
  }
}
