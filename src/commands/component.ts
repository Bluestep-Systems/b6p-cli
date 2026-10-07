import * as fs from "fs";
import * as path from "path";
import type { Command } from "commander";
import type { ComponentBuildStatus } from "@bluestep-systems/b6p-core";
import type { CliContext } from "../context";
import { withCore, type GlobalOpts } from "../context";

/**
 * Find the component's git repo URL when the command gave none: walk up from
 * `cwd` to the nearest `.git/config` and read `origin`'s URL.
 *
 * Deliberately a file read, not a `git` spawn: the CLI must answer the same with
 * or without git on PATH, and the one value needed is a single config line. Only
 * `origin` is consulted — a clone of a component repo has exactly the remote the
 * platform handed out.
 * @param cwd The directory to walk up from
 * @returns The origin URL, or null when no repo or no origin is found
 * @lastreviewed null
 */
export function originUrlFromClone(cwd: string): string | null {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      // The nearest repo answers, even with no readable config or no origin:
      // walking past it would hand back an ENCLOSING repo's origin, which is a
      // different project (a submodule would resolve to its parent's URL).
      const text = readCloneConfig(dir);
      return text === null ? null : parseOriginUrl(text);
    }
    if (path.dirname(dir) === dir) {
      return null;
    }
  }
}

/**
 * The git config text of the repo rooted at `dir`, or null. `.git` is a
 * directory in a primary clone, but a FILE (`gitdir: <path>`) in a linked
 * worktree or a submodule; a worktree's config then lives in the shared
 * directory its `commondir` file names.
 * @lastreviewed null
 */
function readCloneConfig(dir: string): string | null {
  const dotGit = path.join(dir, ".git");
  try {
    return fs.readFileSync(path.join(dotGit, "config"), "utf8");
  } catch {
    // Not a directory with a config; try the pointer-file form.
  }
  let pointer: string;
  try {
    pointer = fs.readFileSync(dotGit, "utf8");
  } catch {
    return null;
  }
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(pointer);
  if (!match) {
    return null;
  }
  const gitDir = path.resolve(dir, match[1]);
  try {
    const common = fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim();
    return fs.readFileSync(path.join(path.resolve(gitDir, common), "config"), "utf8");
  } catch {
    // No commondir: a submodule's gitdir holds the config itself.
  }
  try {
    return fs.readFileSync(path.join(gitDir, "config"), "utf8");
  } catch {
    return null;
  }
}

/**
 * The `url` of `[remote "origin"]` in git-config text, or null. Minimal INI
 * walk: section headers reset the state, the first `url =` inside the origin
 * section answers.
 * @lastreviewed null
 */
export function parseOriginUrl(configText: string): string | null {
  let inOrigin = false;
  for (const raw of configText.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inOrigin = /^\[\s*remote\s+"origin"\s*\]$/.test(line);
      continue;
    }
    if (inOrigin) {
      const match = /^url\s*=\s*(.+)$/i.exec(line);
      if (match) {
        // Unquote, and drop a trailing git-config comment (` # …` / ` ; …`).
        const value = match[1].trim().replace(/\s+[#;].*$/, "");
        return /^".*"$/.test(value) ? value.slice(1, -1) : value;
      }
    }
  }
  return null;
}

/**
 * Resolve the repo URL a component command acts on: the positional argument
 * when given, else the clone's `origin`. Exported for the command-tree test.
 * @throws Error naming both ways to supply it when neither is available
 * @lastreviewed null
 */
export function resolveRepoUrl(given: string | undefined): string {
  if (given) {
    return given;
  }
  const origin = originUrlFromClone(process.cwd());
  if (origin) {
    return origin;
  }
  throw new Error(
    "No component repo URL. Run this inside a clone of the component's repo, or pass the URL: " +
      "b6p component <verb> https://<host>/git/component/<name>.git"
  );
}

/**
 * Print one build's state for a human: state line, diagnostics with their
 * source positions, the captured builder log when the watchdog saved one, and
 * the artifact URL once servable. `--json` consumers get the raw
 * {@link ComponentBuildStatus} instead.
 * @lastreviewed null
 */
function reportBuild(ctx: CliContext, status: ComponentBuildStatus): void {
  ctx.emitJson(status);
  ctx.prompt.info(`Build ${status.buildId} (${status.ref}@${status.sha.slice(0, 12)}): ${status.state}`);
  for (const d of status.diagnostics) {
    const where = d.file
      ? ` ${d.file}${d.line !== null ? `:${d.line}${d.column !== null ? `:${d.column}` : ""}` : ""}`
      : "";
    ctx.prompt.notice(`  [${d.severity}]${where} ${d.message}`);
  }
  if (status.log) {
    ctx.prompt.notice(`Builder log:\n${status.log}`);
  }
  if (status.entryUrl) {
    ctx.prompt.info(`Artifact: ${status.entryUrl}`);
  }
}

/**
 * Mount custom-component operations at `b6p component <verb>`: `build` submits
 * a build of a ref (platform default: the `draft` working branch) and waits for
 * a terminal state unless `--no-wait`; `status` reports the newest build (of an
 * exact `--sha` when given); `publish` publishes the current draft, which the
 * platform accepts only with a SUCCEEDED build of exactly that commit.
 *
 * Every verb takes the component's git repo URL
 * (`https://<host>/git/component/<name>.git`) as its optional positional —
 * inside a clone it is read from `origin`.
 * @lastreviewed null
 */
export function registerComponentCommands(program: Command): void {
  const globals = () => program.opts<GlobalOpts>();
  const component = program.command("component").description("Build and publish BlueStep One custom components");

  component
    .command("build [repo-url]")
    .description("Build the component's source at a ref (default: the draft branch)")
    .option("--ref <ref>", "Branch to build (the platform defaults it to draft)")
    .option("--no-wait", "Return right after the build is queued instead of waiting for it to finish")
    .action(async (repoUrl: string | undefined, opts: { ref?: string; wait: boolean }) => {
      await withCore(globals(), async (ctx) => {
        const status = await ctx.core.component.build({
          repoUrl: resolveRepoUrl(repoUrl),
          ref: opts.ref,
          wait: opts.wait,
        });
        reportBuild(ctx, status);
        if (status.state === "FAILED") {
          ctx.fail("The build failed — the diagnostics above are the builder's own.");
        }
      });
    });

  component
    .command("status [repo-url]")
    .description("Report the component's newest build, or its newest build of an exact commit")
    .option("--sha <sha>", "Report the newest build of exactly this commit")
    .action(async (repoUrl: string | undefined, opts: { sha?: string }) => {
      await withCore(globals(), async (ctx) => {
        const status = await ctx.core.component.status({ repoUrl: resolveRepoUrl(repoUrl), sha: opts.sha });
        if (status === null) {
          // An answer, not a failure: the component exists and was never built.
          ctx.emitJson(null);
          ctx.prompt.info("Never built.");
          return;
        }
        reportBuild(ctx, status);
      });
    });

  component
    .command("publish [repo-url]")
    .description("Publish the component's current draft (needs a SUCCEEDED build of exactly that commit)")
    .action(async (repoUrl: string | undefined) => {
      await withCore(globals(), async (ctx) => {
        // A refusal (no build of the draft's commit, artifact aged out) throws
        // Err.ComponentOperationError carrying the platform's own explanation;
        // the top-level handler prints it and exits 1.
        const status = await ctx.core.component.publish({ repoUrl: resolveRepoUrl(repoUrl) });
        reportBuild(ctx, status);
        ctx.prompt.info("Published.");
      });
    });
}
