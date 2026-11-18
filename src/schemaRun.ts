import * as fs from "fs/promises";
import type { SchemaTestResult } from "@bluestep-systems/b6p-core";
import { resolve, type CliContext } from "./context";
import { NonInteractiveInputError } from "./providers/CliPrompt";
import { outputExistsProblem, toFailureJson, type SchemaCommandFamily, type SchemaErrorJson } from "./schemaOutcome";

/**
 * Reports a schema command that failed before it had a result: its family's `--json` body with `error` set, the
 * message on stderr, and the "how to go on" line when there is one. Exits `1` (through `ctx.fail`).
 * @param ctx The session; only its reporting channels are used
 * @param family Which command failed
 * @param error What to tell the caller
 * @param shown For `apply`, the plan the caller was shown before the failure, if there was one
 * @lastreviewed null
 */
export function reportFailure(
  ctx: Pick<CliContext, "emitJson" | "fail"> & { prompt: Pick<CliContext["prompt"], "notice"> },
  family: SchemaCommandFamily,
  error: SchemaErrorJson,
  shown?: SchemaTestResult
): void {
  ctx.emitJson(toFailureJson(family, error, shown));
  ctx.fail(error.message);
  if (error.howTo !== null) {
    ctx.prompt.notice(error.howTo);
  }
}

/**
 * Whether a file exists.
 * @lastreviewed null
 */
async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `-o <file>` may be written: always when the file is new; when it exists, only when the caller answers
 * `Overwrite` to a destructive question, which `--yes` and an empty answer never accept (the safe choice, Cancel, is
 * the default). With no terminal and no piped answer the file is left alone too.
 * @param prompt Asks the question
 * @param file The path as the user gave it
 * @param resolved The path to look at on disk
 * @param exists Whether a path exists; replaceable for tests
 * @returns Whether to write the file
 * @lastreviewed null
 */
export async function mayWriteOutput(
  prompt: Pick<CliContext["prompt"], "confirm">,
  file: string,
  resolved: string,
  exists: (path: string) => Promise<boolean> = fileExists
): Promise<boolean> {
  if (!(await exists(resolved))) {
    return true;
  }
  try {
    const answer = await prompt.confirm(`${file} already exists. Overwrite it?`, ["Cancel", "Overwrite"], {
      destructive: true,
      safeOption: "Cancel",
    });
    return answer === "Overwrite";
  } catch (err) {
    // No terminal and no piped answer: nobody said Overwrite, so the file stays (reported as OUTPUT_EXISTS).
    if (err instanceof NonInteractiveInputError) {
      return false;
    }
    throw err;
  }
}

/**
 * {@link mayWriteOutput}, reporting a refusal as the command's failure.
 * @returns `true` to go on; `false` when the file was not to be overwritten and the failure is reported
 * @lastreviewed null
 */
export async function checkOutput(
  ctx: CliContext,
  family: SchemaCommandFamily,
  file: string | undefined
): Promise<boolean> {
  if (file === undefined || (await mayWriteOutput(ctx.prompt, file, resolve(file)))) {
    return true;
  }
  reportFailure(ctx, family, outputExistsProblem(file));
  return false;
}
