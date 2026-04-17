import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { B6PCore } from '@bluestep-systems/b6p-core';
import { SharedFilePersistence } from '@bluestep-systems/b6p-core';
import { NodeFileSystem } from './providers/NodeFileSystem';
import { CliPrompt } from './providers/CliPrompt';
import { CliLogger } from './providers/CliLogger';
import { CliProgress } from './providers/CliProgress';
import { Spinner } from './providers/Spinner';

function resolve(p: string): string {
  return path.resolve(process.cwd(), p);
}

async function createCore(
  globalOpts: { yes?: boolean; json?: boolean; verbose?: boolean; quiet?: boolean },
  initialSpinnerLabel = 'Working…',
): Promise<{
  core: B6PCore;
  prompt: CliPrompt;
  spinner: Spinner;
}> {
  const prompt = new CliPrompt({ autoYes: globalOpts.yes, json: globalOpts.json });
  const logger = new CliLogger({ verbose: globalOpts.verbose });
  const progress = new CliProgress({ quiet: globalOpts.quiet || globalOpts.json });
  // Disable the spinner in JSON / quiet mode so stderr stays clean for consumers.
  const spinner = new Spinner(initialSpinnerLabel, {
    enabled: !globalOpts.json && !globalOpts.quiet && process.stderr.isTTY === true,
  });
  prompt.setActivityPauser(spinner);
  logger.setActivityPauser(spinner);
  progress.setActivityPauser(spinner);

  const persistence = new SharedFilePersistence();
  await migrateLegacyDotfiles(persistence);
  const core = new B6PCore({
    fs: new NodeFileSystem(),
    persistence,
    prompt,
    logger,
    progress,
  });
  spinner.start();
  return { core, prompt, spinner };
}

/**
 * One-shot migration from previous persistence formats into the shared
 * `~/.b6p/state.json` + `secrets.enc`. Merges every file in the old
 * per-workspace `~/.b6p/state/` directory (the largest one wins on key
 * collision, since that's almost always the VS Code extension's store)
 * and the plaintext `~/.b6p/secrets.json`. Only runs when the shared
 * target file doesn't yet exist.
 */
async function migrateLegacyDotfiles(persistence: SharedFilePersistence): Promise<void> {
  const configDir = path.join(os.homedir(), '.b6p');
  const legacySecretsPath = path.join(configDir, 'secrets.json');
  const legacyStateDir = path.join(configDir, 'state');

  await persistence.seedIfMissing({
    publicEntries: async () => {
      let entries: { size: number; data: Record<string, unknown> }[] = [];
      try {
        const names = await fs.readdir(legacyStateDir);
        for (const name of names) {
          if (!name.endsWith('.json')) {continue;}
          const full = path.join(legacyStateDir, name);
          try {
            const raw = await fs.readFile(full, 'utf-8');
            const data = JSON.parse(raw) as Record<string, unknown>;
            entries.push({ size: raw.length, data });
          } catch { /* skip unreadable */ }
        }
      } catch { /* no legacy dir */ }
      // Merge small → large so larger files win on collision.
      entries.sort((a, b) => a.size - b.size);
      const merged: Record<string, unknown> = {};
      for (const e of entries) {Object.assign(merged, e.data);}
      return merged;
    },
    secretEntries: async () => {
      try {
        const raw = await fs.readFile(legacySecretsPath, 'utf-8');
        return JSON.parse(raw) as Record<string, string>;
      } catch {
        return {};
      }
    },
  });
}

const program = new Command('b6p')
  .description('BlueStep B6P script management CLI')
  .version('0.0.1')
  .option('--yes', 'Skip confirmation prompts')
  .option('--json', 'Machine-readable JSON output')
  .option('--verbose', 'Verbose logging')
  .option('--quiet', 'Suppress progress output');

// ── Push ──────────────────────────────────────────────────────────

program
  .command('push [target-url]')
  .description('Push a script to a WebDAV target')
  .option('--file <path>', 'Derive target from local file metadata')
  .option('--root <path>', 'Script root folder')
  .option('--snapshot', 'Push as snapshot')
  .option('--message <text>', 'Commit message for snapshot history (implies --snapshot)')
  .action(async (targetUrl: string | undefined, opts: { file?: string; root?: string; snapshot?: boolean; message?: string }) => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    const isSnapshot = opts.snapshot || opts.message !== undefined;
    try {
      if (opts.file) {
        await core.pushCurrent({ filePath: resolve(opts.file), snapshot: isSnapshot, message: opts.message });
      } else {
        await core.push({
          targetUrl,
          rootPath: resolve(opts.root || '.'),
          snapshot: isSnapshot,
          message: opts.message,
        });
      }
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Pull ──────────────────────────────────────────────────────────

program
  .command('pull [formula-url]')
  .description('Pull a script from a WebDAV location')
  .option('--file <path>', 'Derive source from local file metadata')
  .option('--workspace <path>', 'Target workspace folder (default: cwd)')
  .action(async (formulaUrl: string | undefined, opts: { file?: string; workspace?: string }) => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      // Default to "pull current" when no formula URL is given:
      // use --file if provided, otherwise treat cwd as the file path so the
      // script root can be derived by walking up.
      if (!formulaUrl) {
        const filePath = resolve(opts.file ?? '.');
        const workspacePath = opts.workspace
          ? resolve(opts.workspace)
          : core.deriveWorkspacePath(filePath) ?? process.cwd();
        await core.pullCurrent({ filePath, workspacePath });
      } else {
        await core.pull({
          formulaUrl,
          workspacePath: resolve(opts.workspace || '.'),
        });
      }
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Audit ─────────────────────────────────────────────────────────

program
  .command('audit')
  .description('Compare local script against server state')
  .option('--file <path>', 'File within the script to audit (default: cwd)')
  .option('--pull', 'Pull if differences are detected')
  .option('--workspace <path>', 'Workspace folder (default: cwd)')
  .action(async (opts: { file?: string; pull?: boolean; workspace?: string }) => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      const filePath = resolve(opts.file ?? '.');
      const workspacePath = opts.workspace
        ? resolve(opts.workspace)
        : core.deriveWorkspacePath(filePath) ?? process.cwd();
      if (opts.pull) {
        await core.auditPull({ filePath, workspacePath });
      } else {
        const result = await core.audit({ filePath, workspacePath });
        if (globalOpts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        }
      }
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Deploy ────────────────────────────────────────────────────────

program
  .command('deploy <config-file>')
  .description('Quick deploy from a config file to multiple targets')
  .action(async (configFile: string) => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      await core.deploy({ configPath: resolve(configFile) });
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Auth ──────────────────────────────────────────────────────────

const auth = program
  .command('auth')
  .description('Manage credentials');

auth
  .command('set')
  .description('Set or update credentials')
  .action(async () => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      await core.updateCredentials();
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

auth
  .command('clear')
  .description('Clear stored credentials')
  .action(async () => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      await core.auth.clear();
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Sessions ──────────────────────────────────────────────────────

program
  .command('sessions')
  .description('Manage sessions')
  .command('clear')
  .description('Clear all active sessions')
  .action(async () => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      await core.sessionManager.clearAll();
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Config ────────────────────────────────────────────────────────

const config = program
  .command('config')
  .description('Manage configuration');

config
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action(async (key: string, value: string) => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = value;
      }
      await core.setConfig(key, parsed);
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

config
  .command('reset')
  .description('Reset all settings to defaults')
  .action(async () => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      await core.clearSettings();
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Report ────────────────────────────────────────────────────────

program
  .command('report')
  .description('Report current state')
  .action(async () => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      const result = await core.report();
      if (globalOpts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      }
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Check Updates ─────────────────────────────────────────────────

program
  .command('check-updates')
  .description('Check for extension updates')
  .action(async () => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      await core.checkForUpdates();
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Setup ─────────────────────────────────────────────────────────

program
  .command('setup')
  .description('Print the setup URL for a script')
  .requiredOption('--file <path>', 'File within the script')
  .action(async (opts: { file: string }) => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      const url = await core.getSetupUrl({ filePath: resolve(opts.file) });
      if (url) {
        if (globalOpts.json) {
          process.stdout.write(JSON.stringify({ setupUrl: url }, null, 2) + '\n');
        } else {
          prompt.info(`Setup URL: ${url}`);
        }
      }
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

program.parseAsync(process.argv).catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
