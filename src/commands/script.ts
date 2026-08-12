import type { Command } from "commander";
import { resolve, withCore, type GlobalOpts } from "../context";

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
    .action(
      async (
        targetUrl: string | undefined,
        opts: { file?: string; root?: string; snapshot?: boolean; message?: string }
      ) => {
        await withCore(globals(), async ({ core }) => {
          const isSnapshot = opts.snapshot || opts.message !== undefined;
          if (opts.file) {
            await core.script.pushCurrent({
              filePath: resolve(opts.file),
              snapshot: isSnapshot,
              message: opts.message,
            });
          } else {
            await core.script.push({
              targetUrl,
              rootPath: resolve(opts.root || "."),
              snapshot: isSnapshot,
              message: opts.message,
            });
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
      await withCore(globals(), async ({ core }) => {
        // Default to "pull current" when no formula URL is given:
        // use --file if provided, otherwise treat cwd as the file path so the
        // script root can be derived by walking up.
        if (!formulaUrl) {
          const filePath = resolve(opts.file ?? ".");
          const workspacePath = opts.workspace
            ? resolve(opts.workspace)
            : (core.script.deriveWorkspacePath(filePath) ?? process.cwd());
          await core.script.pullCurrent({ filePath, workspacePath });
        } else {
          await core.script.pull({
            formulaUrl,
            workspacePath: resolve(opts.workspace || "."),
          });
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
      await withCore(globals(), async ({ core, emitJson }) => {
        const filePath = resolve(opts.file ?? ".");
        const workspacePath = opts.workspace
          ? resolve(opts.workspace)
          : (core.script.deriveWorkspacePath(filePath) ?? process.cwd());
        if (opts.pull) {
          await core.script.auditPull({ filePath, workspacePath });
        } else {
          emitJson(await core.script.audit({ filePath, workspacePath }));
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
      await withCore(globals(), async ({ core, prompt, globalOpts, emitJson }) => {
        const url = await core.script.getSetupUrl({ filePath: resolve(opts.file) });
        if (url) {
          emitJson({ setupUrl: url });
          if (!globalOpts.json) {
            prompt.info(`Setup URL: ${url}`);
          }
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
    register(script, globals, false);

    const alias = register(program, globals, true);
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
