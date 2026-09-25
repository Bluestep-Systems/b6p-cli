import type { PushResult } from "@bluestep-systems/b6p-core";

/**
 * What `b6p push --json` prints: core's {@link PushResult} plus the files a declined overwrite
 * left alone. One shape for every outcome, so a machine consumer parses a single schema.
 * @lastreviewed null
 */
export type PushJson = PushResult & {
  /**
   * Draft-relative, `/`-separated paths whose overwrite was not confirmed. Empty unless the push
   * stopped at the overwrite confirmation, in which case `pushed` is false and nothing was uploaded.
   * @lastreviewed null
   */
  declinedOverwrites: string[];
};

/**
 * The shell exit code for a finished push.
 *
 * A push that uploaded nothing (bad `--root`, empty draft, a compiled `scripts/app.js` that is
 * missing or has no code) or a snapshot that shipped without a history entry must not report
 * success: that is what let a typo'd `--root` mark a deploy green. A live copy that still reads
 * back wrong after core's one re-send (`liveVerified: false`) is a broken publish (ClickUp
 * 86bbqnrtp). Core already clears `historyRecorded` in that case; it is checked on its own so the
 * reason stays explicit. A snapshot that shipped with type-check diagnostics also fails: the
 * platform runs the emitted JS un-type-checked, so the push was the only gate.
 *
 * Not failures: `null` (the user cancelled at the target-URL prompt), `liveVerified: null` (a copy
 * came back without a content hash and could not be compared; core warns on stderr, and failing
 * here would block every push if the platform's ETag format changed), and `typeCheckDiagnostics`
 * `null` (no compile ran) or `0`.
 * @param result What core's push returned
 * @returns `1` when the push must read as failed, `0` otherwise
 * @lastreviewed null
 */
export function pushExitCode(result: PushResult | null): 0 | 1 {
  if (!result) {
    return 0;
  }
  if (!result.pushed || !result.historyRecorded || result.liveVerified === false) {
    return 1;
  }
  if (result.typeCheckDiagnostics !== null && result.typeCheckDiagnostics > 0) {
    return 1;
  }
  return 0;
}

/**
 * The `--json` body for a push that returned a result.
 * @param result What core's push returned
 * @returns The result with `declinedOverwrites: []`
 * @lastreviewed null
 */
export function toPushJson(result: PushResult): PushJson {
  return { ...result, declinedOverwrites: [] };
}
