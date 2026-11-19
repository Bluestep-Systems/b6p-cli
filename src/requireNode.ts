import { nodeGuardExitCode, nodeVersionProblem } from "./nodeGuard";

// Imported first by index.ts, so it runs before any other module is evaluated.
const problem = nodeVersionProblem(process.versions.node);
if (problem !== null) {
  process.stderr.write(`${problem}\n`);
  // git runs `b6p auth git-credential <action>` as its credential helper and must never see it
  // fail: say why on stderr, answer nothing, exit 0, and git asks its other helpers.
  process.exit(nodeGuardExitCode(process.argv));
}
