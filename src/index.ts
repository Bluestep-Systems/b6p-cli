import { Command } from "commander";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { B6PCore, BearerAuthProvider, Err } from "@bluestep-systems/b6p-core";
import { SharedFilePersistence } from "@bluestep-systems/b6p-core";
import { NodeFileSystem } from "./providers/NodeFileSystem";
import { CliPrompt } from "./providers/CliPrompt";
import { CliLogger } from "./providers/CliLogger";
import { CliProgress } from "./providers/CliProgress";
import { Spinner } from "./providers/Spinner";
import { WindowsRestartManagerLockDiagnoser } from "./lockDiagnoser/WindowsRestartManagerLockDiagnoser";
import { resolveTsLibDirs } from "./tsLibs";
import { GatewayTokenGuardPrompt } from "./auth/GatewayTokenGuard";
import { declinedPushJson, deleteCommand, overwriteCommand, pushExitCode, toPushJson } from "./pushOutcome";

// Replaced at build time by esbuild's `define` with the package.json version.
declare const __B6P_VERSION__: string;

function resolve(p: string): string {
  return path.resolve(process.cwd(), p);
}

async function createCore(
  globalOpts: { yes?: boolean; json?: boolean; verbose?: boolean; quiet?: boolean },
  initialSpinnerLabel = "Working…"
): Promise<{
  core: B6PCore;
  prompt: CliPrompt;
  logger: CliLogger;
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

  // Keep the default `~/.b6p` config dir (undefined), but inject a Windows lock
  // diagnoser so a failed shared-state rename names the processes holding the
  // file. Best-effort and a no-op off Windows; see WindowsRestartManagerLockDiagnoser.
  const persistence = new SharedFilePersistence(undefined, new WindowsRestartManagerLockDiagnoser());
  await migrateLegacyDotfiles(persistence);
  const core = new B6PCore({
    fs: new NodeFileSystem(),
    persistence,
    prompt,
    logger,
    progress,
    // The same bearer scheme core builds by default, but its token prompts refuse a gateway
    // (b6pt_) token before it is stored (see GatewayTokenGuard.ts).
    auth: new BearerAuthProvider(persistence, new GatewayTokenGuardPrompt(prompt), logger),
    // Resolve lib.*.d.ts for the core's bundled TypeScript compile (see tsLibs.ts).
    typescriptLibDirs: resolveTsLibDirs(),
  });
  spinner.start();
  return { core, prompt, logger, spinner };
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
  const configDir = path.join(os.homedir(), ".b6p");
  const legacySecretsPath = path.join(configDir, "secrets.json");
  const legacyStateDir = path.join(configDir, "state");

  await persistence.seedIfMissing({
    publicEntries: async () => {
      let entries: { size: number; data: Record<string, unknown> }[] = [];
      try {
        const names = await fs.readdir(legacyStateDir);
        for (const name of names) {
          if (!name.endsWith(".json")) {
            continue;
          }
          const full = path.join(legacyStateDir, name);
          try {
            const raw = await fs.readFile(full, "utf-8");
            const data = JSON.parse(raw) as Record<string, unknown>;
            entries.push({ size: raw.length, data });
          } catch {
            /* skip unreadable */
          }
        }
      } catch {
        /* no legacy dir */
      }
      // Merge small → large so larger files win on collision.
      entries.sort((a, b) => a.size - b.size);
      const merged: Record<string, unknown> = {};
      for (const e of entries) {
        Object.assign(merged, e.data);
      }
      return merged;
    },
    secretEntries: async () => {
      try {
        const raw = await fs.readFile(legacySecretsPath, "utf-8");
        return JSON.parse(raw) as Record<string, string>;
      } catch {
        return {};
      }
    },
  });
}

const program = new Command("b6p")
  .description("BlueStep B6P script management CLI")
  .version(__B6P_VERSION__)
  .option(
    "--yes",
    "Answer every confirmation with its default and print what it answered. Overwrite and delete " +
      "questions default to Cancel/No, so --yes never overwrites or deletes platform files (see push --overwrite)"
  )
  .option("--json", "Machine-readable JSON output")
  .option("--verbose", "Verbose logging")
  .option("--quiet", "Suppress progress output");

// ── Push ──────────────────────────────────────────────────────────

const PUSH_HELP = `
Questions a push can ask (both default to the safe answer, which --yes and an empty answer take):
  1. Before uploading anything, when files would overwrite a platform version nobody here has
     seen: [Cancel] / Overwrite all. Cancel stops the push with nothing uploaded (exit 1).
  2. After uploading, when the platform has files your draft doesn't: [No] / Yes to delete
     them. No keeps them (exit 0).
  --overwrite <path> answers question 1 for that file up front; repeat it per file, with the path
  as the question lists it (e.g. scripts/app.ts). Question 2 has no flag: run without --yes and
  answer Yes. Answers can be piped, one line per question, in order:
    printf 'Overwrite all\\nYes\\n' | b6p push --file <path>

Exit codes:
  0  pushed (keeping platform-only files is still 0)
  1  nothing uploaded; an overwrite not confirmed; an upload refused; on a snapshot, a live copy
     still wrong after one re-send, no history entry recorded, or type-check diagnostics

--json prints one object on stdout:
  { pushed, historyRecorded, typeCheckDiagnostics, liveVerified, liveMismatches,
    keptPlatformOnly, declinedOverwrites }
  A declined overwrite prints pushed: false with the files in declinedOverwrites; a cancelled
  target-URL prompt prints { cancelled: true }. Questions, warnings and next steps go to stderr.
`;

program
  .command("push [target-url]")
  .description("Push a script to a WebDAV target")
  .option("--file <path>", "Derive target from local file metadata")
  .option("--root <path>", "Script root folder")
  .option("--snapshot", "Push as snapshot")
  .option("--message <text>", "Commit message for snapshot history (implies --snapshot)")
  .option(
    "--overwrite <path>",
    "Overwrite this file on the platform even though it changed there (repeatable; path as the question lists it)",
    (value: string, previous: string[] | undefined) => [...(previous ?? []), value]
  )
  .addHelpText("after", PUSH_HELP)
  .action(
    async (
      targetUrl: string | undefined,
      opts: { file?: string; root?: string; snapshot?: boolean; message?: string; overwrite?: string[] }
    ) => {
      const globalOpts = program.opts();
      const { core, prompt, logger, spinner } = await createCore(globalOpts);
      const isSnapshot = opts.snapshot || opts.message !== undefined;
      // The user's own arguments, to print commands that repeat this push with a confirmation added.
      const args = process.argv.slice(2);
      try {
        const result = opts.file
          ? await core.script.pushCurrent({
              filePath: resolve(opts.file),
              snapshot: isSnapshot,
              message: opts.message,
              overwrite: opts.overwrite,
            })
          : await core.script.push({
              targetUrl,
              rootPath: resolve(opts.root || "."),
              snapshot: isSnapshot,
              message: opts.message,
              overwrite: opts.overwrite,
            });
        if (globalOpts.json) {
          process.stdout.write(JSON.stringify(result ? toPushJson(result) : { cancelled: true }, null, 2) + "\n");
        }
        // Core's warning says which platform-only files were kept and why; how to delete them is ours.
        if (result && result.keptPlatformOnly.length > 0) {
          prompt.notice(
            `To delete ${result.keptPlatformOnly.length === 1 ? "it" : "them"} from the platform, run the push ` +
              `again without --yes and answer Yes to the delete question:\n  ${deleteCommand(args)}`
          );
        }
        // `exitCode` rather than `exit()` so an in-flight --json write still flushes.
        // The rule itself, and why each case fails or not, is in pushOutcome.ts.
        if (pushExitCode(result) !== 0) {
          process.exitCode = 1;
        }
      } catch (e) {
        // Nothing was uploaded. Core's message says which files and why; how to confirm them is ours.
        if (e instanceof Err.OverwriteDeclinedError) {
          spinner.stop();
          prompt.error(e.message);
          prompt.notice(
            `After checking ${e.paths.length === 1 ? "it" : "them"}, overwrite ${e.paths.length === 1 ? "it" : "them"} ` +
              `with your local ${e.paths.length === 1 ? "file" : "files"} with:\n  ${overwriteCommand(args, e.paths)}`
          );
          if (globalOpts.json) {
            process.stdout.write(JSON.stringify(declinedPushJson(e.paths), null, 2) + "\n");
          }
          process.exitCode = 1;
          return;
        }
        // Core logs a refused upload as "Failed to push <file>: <details>" and then rethrows it;
        // the top-level handler would print the same details a second time.
        if (e instanceof Error && logger.hasReported(e.message)) {
          spinner.stop();
          process.stderr.write("Push stopped: the error above has the details.\n");
          process.exitCode = 1;
          return;
        }
        throw e;
      } finally {
        spinner.stop();
        prompt.close();
      }
    }
  );

// ── Pull ──────────────────────────────────────────────────────────

program
  .command("pull [formula-url]")
  .description("Pull a script from a WebDAV location")
  .option("--file <path>", "Derive source from local file metadata")
  .option("--workspace <path>", "Target workspace folder (default: cwd)")
  .action(async (formulaUrl: string | undefined, opts: { file?: string; workspace?: string }) => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      // Default to "pull current" when no formula URL is given:
      // use --file if provided, otherwise treat cwd as the file path so the
      // script root can be derived by walking up.
      let result;
      if (!formulaUrl) {
        const filePath = resolve(opts.file ?? ".");
        const workspacePath = opts.workspace
          ? resolve(opts.workspace)
          : (core.script.deriveWorkspacePath(filePath) ?? process.cwd());
        result = await core.script.pullCurrent({ filePath, workspacePath });
      } else {
        result = await core.script.pull({
          formulaUrl,
          workspacePath: resolve(opts.workspace || "."),
        });
      }
      if (globalOpts.json) {
        process.stdout.write(JSON.stringify(result ?? { cancelled: true }, null, 2) + "\n");
      }
      // `keptLocalPaths` is deliberately NOT an exit-code failure: keeping a
      // locally-edited file is the guard working as designed, and failing here
      // would make every pull in a tree with local edits exit non-zero forever.
      // The outcome reaches machines through --json and humans through the
      // warning core prints.
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Audit ─────────────────────────────────────────────────────────

program
  .command("audit")
  .description("Compare local script against server state")
  .option("--file <path>", "File within the script to audit (default: cwd)")
  .option("--pull", "Pull if differences are detected")
  .option("--workspace <path>", "Workspace folder (default: cwd)")
  .action(async (opts: { file?: string; pull?: boolean; workspace?: string }) => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      const filePath = resolve(opts.file ?? ".");
      const workspacePath = opts.workspace
        ? resolve(opts.workspace)
        : (core.script.deriveWorkspacePath(filePath) ?? process.cwd());
      if (opts.pull) {
        await core.script.auditPull({ filePath, workspacePath });
      } else {
        const result = await core.script.audit({ filePath, workspacePath });
        if (globalOpts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        }
      }
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Deploy ────────────────────────────────────────────────────────

program
  .command("deploy <config-file>")
  .description("Quick deploy from a config file to multiple targets")
  .action(async (configFile: string) => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      await core.script.deploy({ configPath: resolve(configFile) });
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Auth ──────────────────────────────────────────────────────────

const auth = program.command("auth").description("Manage credentials");

auth
  .command("set")
  .description("Set or update credentials")
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
  .command("clear")
  .description("Clear stored credentials")
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
  .command("sessions")
  .description("Manage sessions")
  .command("clear")
  .description("Clear all active sessions")
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

const config = program.command("config").description("Manage configuration");

config
  .command("set <key> <value>")
  .description("Set a configuration value")
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
  .command("reset")
  .description("Reset all settings to defaults")
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
  .command("report")
  .description("Report current state")
  .action(async () => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      const result = await core.report();
      if (globalOpts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      }
    } finally {
      spinner.stop();
      prompt.close();
    }
  });

// ── Check Updates ─────────────────────────────────────────────────

program
  .command("check-updates")
  .description("Check for extension updates")
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
  .command("setup")
  .description("Print the setup URL for a script")
  .requiredOption("--file <path>", "File within the script")
  .action(async (opts: { file: string }) => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      const url = await core.script.getSetupUrl({ filePath: resolve(opts.file) });
      if (url) {
        if (globalOpts.json) {
          process.stdout.write(JSON.stringify({ setupUrl: url }, null, 2) + "\n");
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
