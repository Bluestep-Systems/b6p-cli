import { Err } from "@bluestep-systems/b6p-core";
import type { CliContext } from "./context";
import { describeGatewayError } from "./gatewayErrors";

/**
 * Run a gateway call inside a command action. A gateway error is reported with its "how to fix" text
 * through `ctx.fail`, so the command exits non-zero (and `--json` gets `{ error }`); anything else is
 * rethrown for the top-level handler. Never logs the error object itself.
 * @lastreviewed null
 */
export async function runGateway(ctx: CliContext, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (err) {
    // The configured address is only worth a read when the error is about it.
    const gatewayUrl = err instanceof Err.GatewayConfigError ? await configuredGatewayUrl(ctx) : undefined;
    const text = describeGatewayError(err, { gatewayUrl });
    if (text === undefined) {
      throw err;
    }
    ctx.fail(text);
  }
}

/**
 * The `gatewayUrl` setting, or `undefined` when the default is in use (or it cannot be read).
 * @lastreviewed null
 */
async function configuredGatewayUrl(ctx: CliContext): Promise<string | undefined> {
  try {
    return await ctx.core.getConfig<string>("gatewayUrl");
  } catch {
    return undefined;
  }
}

/**
 * Write to stdout with the stderr spinner out of the way first. The spinner redraws its line on
 * stderr; without the pause, a terminal shows a frame and its label in front of whatever is written,
 * so a token secret would land on a line that starts with "⠋ Creating token…". `pause()` clears
 * the line and does nothing when the spinner is off (pipes, `--json`, `--quiet`).
 * @lastreviewed null
 */
export function writeStdout(ctx: Pick<CliContext, "spinner">, text: string): void {
  ctx.spinner.pause();
  process.stdout.write(text);
}

/**
 * Write a result to stdout: `human` text normally, `json` under `--json`.
 * @lastreviewed null
 */
export function printResult(ctx: CliContext, human: string, json: unknown): void {
  if (ctx.globalOpts.json) {
    ctx.emitJson(json);
  } else {
    writeStdout(ctx, human.endsWith("\n") ? human : human + "\n");
  }
}

/**
 * Left-aligned columns, two spaces apart. No trailing spaces.
 * @lastreviewed null
 */
export function formatTable(header: string[], rows: string[][]): string {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  return all
    .map((r) =>
      r
        .map((c, i) => c.padEnd(widths[i]))
        .join("  ")
        .trimEnd()
    )
    .join("\n");
}
