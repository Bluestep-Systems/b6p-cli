/** The oldest supported Node major. Keep equal to `engines.node` in package.json (a test checks). */
export const MIN_NODE_MAJOR = 24;

/**
 * Why this Node cannot run the CLI, or `null` when it can. `engines` is only advisory to npm, so
 * the CLI checks at startup. The standalone binaries embed their own Node, which always passes.
 * @param version `process.versions.node`
 * @returns A message for stderr, or `null`
 * @lastreviewed null
 */
export function nodeVersionProblem(version: string): string | null {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (Number.isNaN(major) || major >= MIN_NODE_MAJOR) {
    return null;
  }
  return `b6p requires Node.js ${MIN_NODE_MAJOR} or newer; this is Node.js ${version}. Upgrade Node, or use the standalone binary.`;
}
