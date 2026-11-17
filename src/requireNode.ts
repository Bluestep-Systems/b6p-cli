import { nodeVersionProblem } from "./nodeGuard";

// Imported first by index.ts, so it runs before any other module is evaluated.
const problem = nodeVersionProblem(process.versions.node);
if (problem !== null) {
  process.stderr.write(`${problem}\n`);
  process.exit(1);
}
