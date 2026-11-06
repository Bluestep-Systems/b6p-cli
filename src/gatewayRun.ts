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
    const text = describeGatewayError(err);
    if (text === undefined) {
      throw err;
    }
    ctx.fail(text);
  }
}

/**
 * Write a result to stdout: `human` text normally, `json` under `--json`.
 * @lastreviewed null
 */
export function printResult(ctx: CliContext, human: string, json: unknown): void {
  if (ctx.globalOpts.json) {
    ctx.emitJson(json);
  } else {
    process.stdout.write(human.endsWith("\n") ? human : human + "\n");
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
