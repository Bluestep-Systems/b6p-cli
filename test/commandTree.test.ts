// Unit spec for the `b6p` command tree.
//
// The point of the noun-first tree is that the top level is a namespace of
// platform subsystems, so a future `b6p forms pull` can be added without
// colliding with anything. That property is invisible to the type checker — it
// lives in commander's runtime registration — so it is pinned here.
//
// Authored in TS and bundled to dist-test/ by esbuild.test.js, then run with
// `node --test`; see the note in WindowsRestartManagerLockDiagnoser.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command } from "commander";
import { buildProgram } from "../src/program";

/** The pre-0.5.0 top-level verbs, kept as hidden aliases until 0.6.0. */
const DEPRECATED_ALIASES = ["push", "pull", "audit", "deploy", "setup"];

function program(): Command {
  return buildProgram("0.0.0-test");
}

function child(parent: Command, name: string): Command {
  const found = parent.commands.find((c) => c.name() === name);
  assert.ok(found, `expected a \`${name}\` command`);
  return found;
}

test("the top level is nouns only — every verb lives under a namespace", () => {
  const help = program().helpInformation();
  const commandsBlock = help.slice(help.indexOf("Commands:"));

  for (const noun of ["script", "auth", "sessions", "config", "report", "check-updates"]) {
    assert.match(commandsBlock, new RegExp(`^\\s+${noun}\\b`, "m"), `\`${noun}\` should be advertised`);
  }
  // The whole point of the refactor: the deprecated verbs still work but must not
  // occupy an advertised top-level slot, or the noun namespace is not actually free.
  for (const verb of DEPRECATED_ALIASES) {
    assert.doesNotMatch(commandsBlock, new RegExp(`^\\s+${verb}\\b`, "m"), `\`${verb}\` should be hidden`);
  }
});

test("script owns every script-tree verb", () => {
  const script = child(program(), "script");
  assert.deepEqual(
    script.commands.map((c) => c.name()).filter((n) => n !== "help"),
    ["push", "pull", "audit", "deploy", "setup"]
  );
});

test("deprecated top-level aliases are still registered and reachable", () => {
  const names = program().commands.map((c) => c.name());
  for (const verb of DEPRECATED_ALIASES) {
    assert.ok(names.includes(verb), `\`b6p ${verb}\` should still resolve`);
  }
});

test("each alias is definitionally identical to its namespaced form", () => {
  // Both are produced by the same registrar, so this is really a guard against
  // someone hand-editing one copy: the day they diverge, `b6p push` and
  // `b6p script push` would silently mean different things.
  const root = program();
  const script = child(root, "script");
  for (const verb of DEPRECATED_ALIASES) {
    const alias = child(root, verb);
    const namespaced = child(script, verb);
    assert.equal(alias.description(), namespaced.description(), `${verb}: description drifted`);
    assert.deepEqual(
      alias.options.map((o) => o.flags),
      namespaced.options.map((o) => o.flags),
      `${verb}: options drifted`
    );
    assert.equal(alias.usage(), namespaced.usage(), `${verb}: arguments drifted`);
  }
});

test("auth exposes a non-prompting status verb", () => {
  // `status` must exist for unattended use — it is the only way a script can ask
  // whether a token is stored without risking an interactive prompt.
  const auth = child(program(), "auth");
  assert.deepEqual(
    auth.commands.map((c) => c.name()).filter((n) => n !== "help"),
    ["set", "status", "clear"]
  );
});
