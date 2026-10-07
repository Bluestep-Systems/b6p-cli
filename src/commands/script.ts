import type { Command } from "commander";
import { Err } from "@bluestep-systems/b6p-core";
import { resolve, withCore, type GlobalOpts } from "../context";
import {
  declinedPushJson,
  deleteCommand,
  detectShellDialect,
  overwriteCommand,
  pushExitCode,
  toPushJson,
} from "../pushOutcome";

const PUSH_HELP = `
Questions a push can ask (both default to the safe answer, which --yes and an empty answer take):
  1. Before uploading anything, when files would overwrite a platform version nobody here has
     seen: [Cancel] / Overwrite all. Cancel stops the push with nothing uploaded (exit 1).
  2. After uploading, when the platform has files your draft doesn't: [No] / Yes to delete
     them. No keeps them (exit 0).
  --overwrite <path> answers question 1 for that file up front; repeat it per file, with the path
  as the question lists it (e.g. scripts/app.ts). Question 2 has no flag: run without --yes and
  answer Yes. Answers can be piped, one line per question, in order:
    printf 'Overwrite all\\nYes\\n' | b6p script push --file <path>
    'Overwrite all', 'Yes' | b6p script push --file <path>        (PowerShell)

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

/**
 * Registers one script operation onto `parent`.
 *
 * The same registrar serves two parents — the `script` namespace and, with
 * `hidden` set, the deprecated top-level alias — so the flags and behaviour of
 * `b6p push` and `b6p script push` cannot drift apart. Returns the created
 * command so the caller can attach the deprecation hook.
 * @lastreviewed null
 */
type Registrar = (parent: Command, globals: () => GlobalOpts, hidden: boolean) => Command;

const addPush: Registrar = (parent, globals, hidden) =>
  parent
    .command("push [target-url]", { hidden })
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
        await withCore(globals(), async ({ core, prompt, logger, spinner, emitJson }) => {
          const isSnapshot = opts.snapshot || opts.message !== undefined;
          // The user's own arguments, to print commands that repeat this push with a confirmation added.
          const args = process.argv.slice(2);
          const dialect = detectShellDialect();
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
            emitJson(result ? toPushJson(result) : { cancelled: true });
            // Core's warning says which platform-only files were kept and why; how to delete them is ours.
            if (result && result.keptPlatformOnly.length > 0) {
              prompt.notice(
                `To delete ${result.keptPlatformOnly.length === 1 ? "it" : "them"} from the platform, run the push ` +
                  `again without --yes and answer Yes to the delete question:\n  ${deleteCommand(args, dialect)}`
              );
            }
            // Core already said what happened and why; the rule itself, and why
            // each case fails or not, is in pushOutcome.ts. `exitCode` directly
            // rather than fail(): a second ERROR line would repeat core's report.
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
                  `with your local ${e.paths.length === 1 ? "file" : "files"} with:\n  ${overwriteCommand(args, e.paths, dialect)}`
              );
              emitJson(declinedPushJson(e.paths));
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
          }
        });
      }
    );

const addPull: Registrar = (parent, globals, hidden) =>
  parent
    .command("pull [formula-url]", { hidden })
    .description("Pull a script from a WebDAV location")
    .option("--file <path>", "Derive source from local file metadata")
    .option("--workspace <path>", "Target workspace folder (default: cwd)")
    .action(async (formulaUrl: string | undefined, opts: { file?: string; workspace?: string }) => {
      await withCore(globals(), async ({ core, emitJson }) => {
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
        if (result !== null) {
          // `keptLocalPaths` is reported, never failed: keeping a locally-edited
          // file is the divergence guard working as intended, and failing here
          // would make every pull in a tree with local edits exit non-zero.
          emitJson(result);
        }
      });
    });

const addAudit: Registrar = (parent, globals, hidden) =>
  parent
    .command("audit", { hidden })
    .description("Compare local script against server state")
    .option("--file <path>", "File within the script to audit (default: cwd)")
    .option("--pull", "Pull if differences are detected")
    .option("--workspace <path>", "Workspace folder (default: cwd)")
    .action(async (opts: { file?: string; pull?: boolean; workspace?: string }) => {
      await withCore(globals(), async ({ core, emitJson, fail }) => {
        const filePath = resolve(opts.file ?? ".");
        const workspacePath = opts.workspace
          ? resolve(opts.workspace)
          : (core.script.deriveWorkspacePath(filePath) ?? process.cwd());
        if (opts.pull) {
          await core.script.auditPull({ filePath, workspacePath });
        } else {
          const result = await core.script.audit({ filePath, workspacePath });
          if (result === null) {
            // Core returns null here WITHOUT reporting an error, unlike push and
            // pull on the same condition. Emitting it would put a literal `null`
            // on stdout at exit 0, so `jq '.changedFiles | length'` reads 0 and
            // the caller concludes "in sync" from a command that never reached
            // the server.
            fail(`Could not determine which script to audit from ${filePath}. Pull the script first.`);
          } else {
            emitJson(result);
          }
        }
      });
    });

const addDeploy: Registrar = (parent, globals, hidden) =>
  parent
    .command("deploy <config-file>", { hidden })
    .description("Quick deploy from a config file to multiple targets")
    .action(async (configFile: string) => {
      await withCore(globals(), async ({ core }) => {
        await core.script.deploy({ configPath: resolve(configFile) });
      });
    });

const addSetup: Registrar = (parent, globals, hidden) =>
  parent
    .command("setup", { hidden })
    .description("Print the web-UI setup URL for a script")
    .requiredOption("--file <path>", "File within the script")
    .action(async (opts: { file: string }) => {
      await withCore(globals(), async ({ core, prompt, emitJson, fail, hasFailed }) => {
        const url = await core.script.getSetupUrl({ filePath: resolve(opts.file) });
        if (url) {
          emitJson({ setupUrl: url });
          // `info` is already a no-op under --json.
          prompt.info(`Setup URL: ${url}`);
        } else if (!hasFailed()) {
          // Core reports most null returns itself, but its catch-all logs to the
          // logger and returns null — which is diagnostic, not a failure signal.
          // Cover that gap without double-reporting the cases core did announce.
          fail(`Could not resolve a setup URL for ${opts.file}.`);
        }
      });
    });

/** Every script-tree operation, in the order they appear in `b6p script --help`. */
const REGISTRARS: Registrar[] = [addPush, addPull, addAudit, addDeploy, addSetup];

/**
 * Mount the script subsystem at `b6p script <verb>`, plus hidden top-level
 * aliases for the pre-0.5.0 spellings.
 *
 * The aliases exist because `b6p push` / `b6p pull` are already embedded in CI
 * pipelines that a global `npm i -g` upgrade would silently break. They are
 * hidden from `--help`, warn on stderr, and are scheduled for removal in 0.6.0 —
 * at which point the top-level slot is a pure noun namespace.
 * @lastreviewed null
 */
export function registerScriptCommands(program: Command): void {
  const globals = () => program.opts<GlobalOpts>();
  const script = program.command("script").description("Manage script trees on the platform");

  for (const register of REGISTRARS) {
    const namespaced = register(script, globals, false);

    const alias = register(program, globals, true);
    // The preAction hook below only fires when the action runs. `b6p push --help`,
    // `b6p help push` and any argument-validation failure short-circuit before
    // that, so the description carries the notice too — it is the one thing shown
    // on every one of those paths.
    alias.description(`${namespaced.description()} (deprecated: use \`b6p script ${alias.name()}\`)`);
    // preAction fires before the shared action body, so the warning lands ahead of
    // any output the command itself produces. stderr keeps `--json` stdout clean.
    alias.hook("preAction", () => {
      process.stderr.write(
        `warning: \`b6p ${alias.name()}\` is deprecated and will be removed in 0.6.0 — ` +
          `use \`b6p script ${alias.name()}\` instead.\n`
      );
    });
  }
}
