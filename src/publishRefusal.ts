import { bsjsGit, type PublishRefusal } from "@bluestep-systems/b6p-core";

/**
 * The platform's structured refusal of a publish, as core reports it on a push, a deploy target, or a thrown error:
 * `reason` (`BUILD_STALE`, `BUILD_MANIFEST_MISSING`, `BUILD_MANIFEST_INVALID`, or another such as `DRAFT_MOVED`) and
 * `withheld`, the stale source paths or the manifest's path.
 * @lastreviewed null
 */
export type { PublishRefusal };

/**
 * Recognizes a build-manifest refusal that was thrown (core's classes, each carrying the platform's `withheld` list).
 * @param e Anything thrown
 * @returns The refusal, or `null` (any other error)
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
        "Run `b6p script push --snapshot` again: the platform rebuilds the draft on every push."
      );
    case "BUILD_MANIFEST_MISSING":
      return (
        "The draft was pushed but not published: it has TypeScript sources but no build manifest" +
        `${refusal.withheld.length > 0 ? ` (expected at ${refusal.withheld[0]})` : ""}.\n` +
        "The platform writes the manifest only after a clean build: fix the build's ERROR diagnostics and run " +
        "`b6p script push --snapshot` again. A script built outside b6p needs its externallyBuilt flag set on the platform."
      );
    case "BUILD_MANIFEST_INVALID":
      return (
        "The draft was pushed but not published: its build manifest cannot be read" +
        `${refusal.withheld.length > 0 ? ` (${refusal.withheld[0]})` : ""}.\n` +
        "Run `b6p script push --snapshot` again: the platform rebuilds the draft and writes a fresh one."
      );
    case "DRAFT_MOVED":
      return (
        "The draft was pushed but not published: the platform's draft moved before the publish.\n" +
        "Run `b6p script pull`, then `b6p script push --snapshot` again."
      );
    default:
      return `The draft was pushed but the platform refused to publish it (${refusal.reason})${paths}`;
  }
}
