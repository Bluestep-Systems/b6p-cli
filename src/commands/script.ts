import type { Command } from "commander";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { resolveGitIdentity, type B6PCore } from "@bluestep-systems/b6p-core";
import { resolve, withCore, type GlobalOpts } from "../context";
import {
  canonicalPushArgs,
  deleteCommand,
  describePush,
  detectShellDialect,
  pushExitCode,
  pushFailureNotice,
  SWITCHED_TO_GIT_NOTICE,
  toPushJson,
} from "../pushOutcome";
import { describeGitError } from "../gitErrors";
import { pushFailureOf } from "../pushFailure";
import { deployFailsOnTypeErrors, describeDeploy, planDeploy, removeTempDir } from "../deployRun";
import { AUTHOR_SETTING, chooseAuthor, type CommitAuthor } from "../author";

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
 * @lastreviewed null
 */
async function chosenAuthor(core: B6PCore, flag: string | undefined): Promise<CommitAuthor | undefined> {
  return chooseAuthor(flag, await core.getConfig<unknown>(AUTHOR_SETTING));
}

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

const addPush: Registrar = (parent, globals, hidden) =>
  parent
    .command("push [target-url]", { hidden })
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
        await withCore(globals(), async ({ core, prompt, logger, spinner, emitJson, fail, hasFailed }) => {
          const isSnapshot = opts.snapshot || opts.message !== undefined;
          // The user's own arguments, to print commands that repeat this push with a confirmation added.
          const args = canonicalPushArgs(process.argv.slice(2));
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
            if (result === null) {
              // Cancelled at the target-URL prompt, which is not a failure.
              emitJson({ cancelled: true });
              return;
            }
            const lines = describePush(result, isSnapshot);
            lines.info.forEach((line) => prompt.info(line));
            lines.warnings.forEach((line) => prompt.warn(line));
            lines.errors.forEach((line) => fail(line));
            lines.notices.forEach((line) => prompt.notice(line));
            emitJson(toPushJson(result));
            // Core's warning says which platform-only files were kept and why; how to delete them is ours.
            if (result.keptPlatformOnly.length > 0) {
              prompt.notice(
                `To delete ${result.keptPlatformOnly.length === 1 ? "it" : "them"} from the platform, run the push ` +
                  `again without --yes and answer Yes to the delete question:\n  ${deleteCommand(args, dialect)}`
              );
            }
            // Core usually reports a failed push itself; the CLI adds its line only when it did not,
            // so a failed push prints one error. The exit code below does not depend on it.
            const notice = pushFailureNotice(result, hasFailed());
            if (notice !== null) {
              fail(notice);
            }
            // The rule for every outcome (live copy wrong, type-check diagnostics, ...) is in pushOutcome.ts.
            // `exitCode` rather than `exit()` so an in-flight --json write still flushes.
            if (pushExitCode(result, isSnapshot, opts.failOnTypeErrors === true) !== 0) {
              process.exitCode = 1;
            }
          } catch (e) {
            // No author, a git refusal, or a declined overwrite: nothing was committed. Core's message says what
            // and why; how to go on is ours.
            const failure = pushFailureOf(e, args, dialect);
            if (failure) {
              spinner.stop();
              fail(failure.message);
              if (failure.notice) {
                prompt.notice(failure.notice);
              }
              if (failure.switchedToGit) {
                prompt.notice(SWITCHED_TO_GIT_NOTICE);
              }
              emitJson(failure.json);
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
    .description("Pull a script's draft (git clone, or fast-forward of an existing clone) into the workspace")
    .option("--file <path>", "Derive source from local file metadata")
    .option("--workspace <path>", "Target workspace folder (default: cwd)")
    .option("--enable-git", ENABLE_GIT_HELP)
    .action(
      async (formulaUrl: string | undefined, opts: { file?: string; workspace?: string; enableGit?: boolean }) => {
        await withCore(globals(), async ({ core, prompt, spinner, emitJson, fail }) => {
          // Default to "pull current" when no formula URL is given:
          // use --file if provided, otherwise treat cwd as the file path so the
          // script root can be derived by walking up.
          let result;
          try {
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
          } catch (e) {
            // Staged changes or a symlink in the way: nothing was changed. Say what to do.
            const gitMessage = describeGitError(e);
            if (gitMessage === undefined) {
              throw e;
            }
            spinner.stop();
            fail(gitMessage);
            if ((e as { switchedToGit?: unknown }).switchedToGit === true) {
              prompt.notice(SWITCHED_TO_GIT_NOTICE);
            }
            emitJson({ cancelled: true });
            return;
          }
          if (result?.switchedToGit) {
            prompt.notice(SWITCHED_TO_GIT_NOTICE);
          }
          if (result !== null) {
            // `keptLocalPaths` is reported, never failed: keeping a locally-edited
            // file is the divergence guard working as intended, and failing here
            // would make every pull in a tree with local edits exit non-zero.
            emitJson(result);
          }
        });
      }
    );

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
      await withCore(globals(), async ({ core, prompt, fail }) => {
        const original = resolve(configFile);
        const text = await fs.readFile(original, "utf-8").catch(() => null);
        const plan = await planDeploy(text, opts.author, await core.getConfig<unknown>(AUTHOR_SETTING), (dir) =>
          resolveGitIdentity({ dir })
        );
        if (!plan.ok) {
          fail(plan.message);
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
          outcome.errors.forEach((line) => fail(line));
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
 * aliases for the spellings that predate the noun-first tree.
 *
 * The aliases exist because `b6p push` / `b6p pull` are already embedded in CI
 * pipelines that a global `npm i -g` upgrade would silently break. They are
 * hidden from `--help`, warn on stderr, and are scheduled for removal in a future release —
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
        `warning: \`b6p ${alias.name()}\` is deprecated and will be removed in a future release — ` +
          `use \`b6p script ${alias.name()}\` instead.\n`
      );
    });
  }
}
