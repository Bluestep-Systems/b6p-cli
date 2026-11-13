import { Command } from "commander";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { B6PCore, resolveGitIdentity } from "@bluestep-systems/b6p-core";
import { SharedFilePersistence } from "@bluestep-systems/b6p-core";
import { NodeFileSystem } from "./providers/NodeFileSystem";
import { CliPrompt } from "./providers/CliPrompt";
import { CliLogger } from "./providers/CliLogger";
import { CliProgress } from "./providers/CliProgress";
import { Spinner } from "./providers/Spinner";
import { WindowsRestartManagerLockDiagnoser } from "./lockDiagnoser/WindowsRestartManagerLockDiagnoser";
import { resolveTsLibDirs } from "./tsLibs";
import {
  deleteCommand,
  describePush,
  detectShellDialect,
  pushExitCode,
  SWITCHED_TO_GIT_NOTICE,
  toPushJson,
} from "./pushOutcome";
import { describeGitError } from "./gitErrors";
import { pushFailureOf } from "./pushFailure";
import { deployFailsOnTypeErrors, describeDeploy, planDeploy, removeTempDir } from "./deployRun";
import { AUTHOR_SETTING, chooseAuthor, type CommitAuthor } from "./author";

const ENABLE_GIT_HELP =
  "Switch a script that still publishes over WebDAV to git without asking. The switch is one-way. " +
  "Without this flag the switch is asked about first, and --yes (or an empty answer) declines it";

const FAIL_ON_TYPE_ERRORS_HELP =
  "Exit 1 when type-checking reports errors in the script's own sources. Default: they are printed as warnings " +
  "and the exit code stays 0 (errors in .d.ts files never count). Syntax and emit errors always exit 1";

const AUTHOR_FLAG_HELP =
  'Commit author, "Name <email>". Default: the "author" setting (b6p config set author "Name <email>"), ' +
  "then git config user.name/user.email for the script folder, then GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL";

/**
 * The author the CLI chose for this run (`--author`, else the stored setting); `undefined` leaves it to core.
 */
async function chosenAuthor(core: B6PCore, flag: string | undefined): Promise<CommitAuthor | undefined> {
  return chooseAuthor(flag, await core.getConfig<unknown>(AUTHOR_SETTING));
}

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
    'Overwrite all', 'Yes' | b6p push --file <path>        (PowerShell)

A push is a git commit of the draft folder, made by --author (the flag has the fallbacks). A script
still on WebDAV is switched to git by its first push; the switch is one-way, and is reported.
--snapshot also publishes the draft commit; --message sets the commit message and implies --snapshot.

Exit codes:
  0  pushed (keeping platform-only files is still 0)
  1  nothing pushed (pushed false: bad --root, empty draft, an overwrite not confirmed, a missing
     author, an upload refused); on a snapshot also: no published commit (publishedSha null), the
     platform refused or failed the publish (publishError), or the published branch reads back at
     another commit (liveVerified false). Type errors only warn (exit 0) unless --fail-on-type-errors

--json prints one object on stdout:
  { pushed, commitSha, publishedSha, publishError, publishRefusal, switchedToGit, typeCheckErrors,
    typeCheckDiagnostics, liveVerified, liveMismatches, keptPlatformOnly, declinedOverwrites }
  commitSha: the draft commit after the push. publishedSha: the commit published (snapshot only,
  else null). publishError: why the publish failed, else null. publishRefusal: { reason, withheld } when the platform
  refused because the build is missing, unreadable or stale (BUILD_STALE, BUILD_MANIFEST_MISSING,
  BUILD_MANIFEST_INVALID): rebuild and push; else null. switchedToGit: this push moved the
  script from WebDAV to git. A declined overwrite prints pushed: false with the files in
  declinedOverwrites; a cancelled target-URL prompt prints { cancelled: true }. Questions, warnings
  and next steps go to stderr.
`;

program
  .command("push [target-url]")
  .description("Push a script: commit its draft folder to the script's git repo (and publish it with --snapshot)")
  .option("--file <path>", "Derive target from local file metadata")
  .option("--root <path>", "Script root folder")
  .option("--snapshot", "Push as snapshot")
  .option("--message <text>", "Commit message (implies --snapshot)")
  .option("--author <name-and-email>", AUTHOR_FLAG_HELP)
  .option("--enable-git", ENABLE_GIT_HELP)
  .option("--fail-on-type-errors", FAIL_ON_TYPE_ERRORS_HELP)
  .option(
    "--externally-built",
    "The script is built by a bundler outside b6p (its externallyBuilt flag on the platform): the push writes no " +
      "build manifest and the platform skips its stale-build check"
  )
  .option(
    "--overwrite <path>",
    "Overwrite this file on the platform even though it changed there (repeatable; path as the question lists it)",
    (value: string, previous: string[] | undefined) => [...(previous ?? []), value]
  )
  .addHelpText("after", PUSH_HELP)
  .action(
    async (
      targetUrl: string | undefined,
      opts: {
        file?: string;
        root?: string;
        snapshot?: boolean;
        message?: string;
        author?: string;
        enableGit?: boolean;
        externallyBuilt?: boolean;
        failOnTypeErrors?: boolean;
        overwrite?: string[];
      }
    ) => {
      const globalOpts = program.opts();
      const { core, prompt, logger, spinner } = await createCore(globalOpts);
      const isSnapshot = opts.snapshot || opts.message !== undefined;
      // The user's own arguments, to print commands that repeat this push with a confirmation added.
      const args = process.argv.slice(2);
      const dialect = detectShellDialect();
      try {
        const author = await chosenAuthor(core, opts.author);
        const result = opts.file
          ? await core.script.pushCurrent({
              filePath: resolve(opts.file),
              snapshot: isSnapshot,
              message: opts.message,
              overwrite: opts.overwrite,
              author,
              enableGit: opts.enableGit,
              externallyBuilt: opts.externallyBuilt,
            })
          : await core.script.push({
              targetUrl,
              rootPath: resolve(opts.root || "."),
              snapshot: isSnapshot,
              message: opts.message,
              overwrite: opts.overwrite,
              author,
              enableGit: opts.enableGit,
              externallyBuilt: opts.externallyBuilt,
            });
        if (result) {
          const lines = describePush(result, isSnapshot);
          lines.info.forEach((line) => prompt.info(line));
          lines.warnings.forEach((line) => prompt.warn(line));
          lines.errors.forEach((line) => prompt.error(line));
          lines.notices.forEach((line) => prompt.notice(line));
        }
        if (globalOpts.json) {
          process.stdout.write(JSON.stringify(result ? toPushJson(result) : { cancelled: true }, null, 2) + "\n");
        }
        // Core's warning says which platform-only files were kept and why; how to delete them is ours.
        if (result && result.keptPlatformOnly.length > 0) {
          prompt.notice(
            `To delete ${result.keptPlatformOnly.length === 1 ? "it" : "them"} from the platform, run the push ` +
              `again without --yes and answer Yes to the delete question:\n  ${deleteCommand(args, dialect)}`
          );
        }
        // `exitCode` rather than `exit()` so an in-flight --json write still flushes.
        // The rule itself, and why each case fails or not, is in pushOutcome.ts.
        if (pushExitCode(result, isSnapshot, opts.failOnTypeErrors === true) !== 0) {
          process.exitCode = 1;
        }
      } catch (e) {
        // No author, a git refusal, or a declined overwrite: nothing was committed. Say what to do.
        const failure = pushFailureOf(e, args, dialect);
        if (failure) {
          spinner.stop();
          prompt.error(failure.message);
          if (failure.notice) {
            prompt.notice(failure.notice);
          }
          if (failure.switchedToGit) {
            prompt.notice(SWITCHED_TO_GIT_NOTICE);
          }
          if (globalOpts.json) {
            process.stdout.write(JSON.stringify(failure.json, null, 2) + "\n");
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
  .description("Pull a script's draft (git clone, or fast-forward of an existing clone) into the workspace")
  .option("--file <path>", "Derive source from local file metadata")
  .option("--workspace <path>", "Target workspace folder (default: cwd)")
  .option("--enable-git", ENABLE_GIT_HELP)
  .action(async (formulaUrl: string | undefined, opts: { file?: string; workspace?: string; enableGit?: boolean }) => {
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
        result = await core.script.pullCurrent({ filePath, workspacePath, enableGit: opts.enableGit });
      } else {
        result = await core.script.pull({
          formulaUrl,
          workspacePath: resolve(opts.workspace || "."),
          enableGit: opts.enableGit,
        });
      }
      if (result?.switchedToGit) {
        prompt.notice(
          "This script was switched from WebDAV to git publishing. The switch is one-way: its draft and " +
            "snapshot no longer accept WebDAV writes."
        );
      }
      if (globalOpts.json) {
        process.stdout.write(JSON.stringify(result ?? { cancelled: true }, null, 2) + "\n");
      }
      // `keptLocalPaths` is deliberately NOT an exit-code failure: keeping a
      // locally-edited file is the guard working as designed, and failing here
      // would make every pull in a tree with local edits exit non-zero forever.
      // The outcome reaches machines through --json and humans through the
      // warning core prints.
    } catch (e) {
      // Staged changes or a symlink in the way: nothing was changed. Say what to do.
      const gitMessage = describeGitError(e);
      if (gitMessage === undefined) {
        throw e;
      }
      spinner.stop();
      prompt.error(gitMessage);
      if ((e as { switchedToGit?: unknown }).switchedToGit === true) {
        prompt.notice(SWITCHED_TO_GIT_NOTICE);
      }
      if (globalOpts.json) {
        process.stdout.write(JSON.stringify({ cancelled: true }, null, 2) + "\n");
      }
      process.exitCode = 1;
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
  .option(
    "--author <name-and-email>",
    AUTHOR_FLAG_HELP + '. The config file\'s own "author" is used when this is not given'
  )
  .option("--fail-on-type-errors", FAIL_ON_TYPE_ERRORS_HELP)
  .addHelpText(
    "after",
    `
Config file: { "sourceRootPath": "<script root>", "targets": [{ "url": "<formula url>", "snapshot": true }],
  "author": { "name": "Jane Doe", "email": "jane@example.com" }  (or "Jane Doe <jane@example.com>"; optional),
  "message": "<commit message for every target>" (optional),
  "externallyBuilt": true  (optional: a bundler builds these scripts, so no build manifest is written),
  "failOnTypeErrors": true  (optional: type errors in the script's sources fail the deploy; same as --fail-on-type-errors) }
Every target gets a git commit of the source draft; "snapshot": true also publishes it.
`
  )
  .action(async (configFile: string, opts: { author?: string; failOnTypeErrors?: boolean }) => {
    const globalOpts = program.opts();
    const { core, prompt, spinner } = await createCore(globalOpts);
    try {
      const original = resolve(configFile);
      const text = await fs.readFile(original, "utf-8").catch(() => null);
      const plan = await planDeploy(text, opts.author, await core.getConfig<unknown>(AUTHOR_SETTING), (dir) =>
        resolveGitIdentity({ dir })
      );
      if (!plan.ok) {
        prompt.error(plan.message);
        process.exitCode = 1;
        return;
      }
      let tempDir: string | undefined;
      try {
        let configPath = original;
        if (plan.configText !== null) {
          // Core reads the author from the config file, so hand it a copy that carries the chosen one.
          tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "b6p-deploy-"));
          configPath = path.join(tempDir, "deploy.json");
          await fs.writeFile(configPath, plan.configText, "utf-8");
        }
        const results = await core.script.deploy({ configPath });
        const outcome = describeDeploy(results, deployFailsOnTypeErrors(opts.failOnTypeErrors, text));
        outcome.info.forEach((line) => prompt.info(line));
        outcome.warnings.forEach((line) => prompt.warn(line));
        outcome.errors.forEach((line) => prompt.error(line));
        outcome.notices.forEach((line) => prompt.notice(line));
        if (outcome.exitCode !== 0) {
          process.exitCode = 1;
        }
      } finally {
        if (tempDir) {
          await removeTempDir(
            tempDir,
            (dir) => fs.rm(dir, { recursive: true, force: true }),
            (message) => prompt.warn(message)
          );
        }
      }
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
