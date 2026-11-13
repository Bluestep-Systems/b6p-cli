import { bsjsGit } from "@bluestep-systems/b6p-core";

/**
 * A publish the platform refused because of the build manifest (contract v1): the draft's compiled output is missing,
 * unreadable, or older than its sources. The draft stays pushed; the published script is unchanged.
 * @lastreviewed null
 */
export interface PublishRefusal {
  /**
   * `BUILD_STALE` (sources changed since the build), `BUILD_MANIFEST_MISSING` (a `tsconfig.json` but no manifest) or
   * `BUILD_MANIFEST_INVALID` (the manifest cannot be read).
   * @lastreviewed null
   */
  reason: "BUILD_STALE" | "BUILD_MANIFEST_MISSING" | "BUILD_MANIFEST_INVALID";
  /**
   * The stale source paths (`BUILD_STALE`) or the manifest's path (the other two), when known. Core reports a failed
   * publish to a push only as text, so for a push this is read out of the platform's message and is empty when the
   * message names none; a thrown error carries the platform's list itself.
   * @lastreviewed null
   */
  withheld: string[];
}

const REASONS: ReadonlySet<string> = new Set(["BUILD_STALE", "BUILD_MANIFEST_MISSING", "BUILD_MANIFEST_INVALID"]);

/**
 * Recognizes a build-manifest refusal in what a push reports as `publishError`
 * (`Publish refused (BUILD_STALE): The script was not published: its build is stale against a.ts, b.ts; rebuild and push ...`).
 * @param publishError core's `PushResult.publishError`
 * @returns The refusal, or `null` for any other (or no) publish error
 * @lastreviewed null
 */
export function publishRefusalOf(publishError: string | null): PublishRefusal | null {
  const reason = publishError === null ? undefined : /\((BUILD_[A-Z_]+)\)/.exec(publishError)?.[1];
  if (publishError === null || reason === undefined || !REASONS.has(reason)) {
    return null;
  }
  const named = /stale against (.+?);/.exec(publishError)?.[1];
  const withheld =
    reason === "BUILD_STALE" && named !== undefined
      ? named
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0 && !/^and \d+ more$/.test(p))
      : [];
  return { reason: reason as PublishRefusal["reason"], withheld };
}

/**
 * Recognizes a build-manifest refusal that was thrown (core's classes, each carrying the platform's `withheld` list).
 * @param e Anything thrown
 * @returns The refusal, or `null`
 * @lastreviewed null
 */
export function publishRefusalOfError(e: unknown): PublishRefusal | null {
  if (e instanceof bsjsGit.PublishBuildStaleError) {
    return { reason: "BUILD_STALE", withheld: e.withheld };
  }
  if (e instanceof bsjsGit.PublishBuildManifestMissingError) {
    return { reason: "BUILD_MANIFEST_MISSING", withheld: e.withheld };
  }
  if (e instanceof bsjsGit.PublishBuildManifestInvalidError) {
    return { reason: "BUILD_MANIFEST_INVALID", withheld: e.withheld };
  }
  return null;
}

/**
 * The text a human reads for a refusal: what happened, the paths, and the fix.
 * @param refusal The refusal
 * @returns A message for stderr
 * @lastreviewed null
 */
export function describePublishRefusal(refusal: PublishRefusal): string {
  const paths = refusal.withheld.length > 0 ? `\n\n${refusal.withheld.join("\n")}\n` : "";
  switch (refusal.reason) {
    case "BUILD_STALE":
      return (
        "The draft was pushed but not published: its compiled output is older than its sources" +
        `${refusal.withheld.length > 0 ? " (these files changed after the build)" : ""}.${paths}\n` +
        "Rebuild and push again."
      );
    case "BUILD_MANIFEST_MISSING":
      return (
        "The draft was pushed but not published: it has a tsconfig.json but no build manifest" +
        `${refusal.withheld.length > 0 ? ` (expected at ${refusal.withheld[0]})` : ""}.\n` +
        "Rebuild and push again (a push builds the script and writes the manifest). If a bundler outside b6p builds " +
        "this script, push with --externally-built."
      );
    case "BUILD_MANIFEST_INVALID":
      return (
        "The draft was pushed but not published: its build manifest cannot be read" +
        `${refusal.withheld.length > 0 ? ` (${refusal.withheld[0]})` : ""}.\n` +
        "Rebuild and push again to write a fresh one."
      );
  }
}
