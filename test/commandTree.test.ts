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

/**
 * Names commander would actually print under "Commands:".
 *
 * Asserted over `visibleCommands` rather than by regex against `helpInformation()`:
 * `\s` matches newlines, so `^\s+push\b` also matches the wrapped continuation
 * line of any description containing that word. The regex form would have passed
 * with the command deleted and failed the day a description wrapped awkwardly.
 */
function visibleTopLevel(): string[] {
  const root = program();
  return root
    .createHelp()
    .visibleCommands(root)
    .map((c) => c.name())
    .filter((n) => n !== "help");
}

test("no script verb occupies a top-level slot", () => {
  const visible = visibleTopLevel();
  for (const noun of ["script", "auth", "sessions", "config"]) {
    assert.ok(visible.includes(noun), `\`${noun}\` should be advertised`);
  }
  // The whole point of the refactor: the deprecated verbs still work but must not
  // occupy an advertised top-level slot, or the noun namespace is not actually free.
  for (const verb of DEPRECATED_ALIASES) {
    assert.ok(!visible.includes(verb), `\`${verb}\` should be hidden`);
  }
});

test("the advertised top level is exactly the documented set", () => {
  // `report` and `check-updates` are machine-local commands, not platform
  // subsystems; they are the acknowledged exceptions to the noun rule (see
  // AGENTS.md). Pinning the whole list means adding anything new is a deliberate
  // decision rather than a drift.
  assert.deepEqual(visibleTopLevel(), ["script", "auth", "sessions", "config", "report", "check-updates"]);
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

test("each alias accepts exactly what its namespaced form accepts", () => {
  const root = program();
  const script = child(root, "script");
  for (const verb of DEPRECATED_ALIASES) {
    const alias = child(root, verb);
    const namespaced = child(script, verb);
    assert.deepEqual(
      alias.options.map((o) => o.flags),
      namespaced.options.map((o) => o.flags),
      `${verb}: options drifted`
    );
    assert.equal(alias.usage(), namespaced.usage(), `${verb}: arguments drifted`);
  }
});

test("the alias description carries the deprecation notice", () => {
  // This is the ONLY notice on the paths that never run an action — `b6p push
  // --help`, `b6p help push`, and any argument-validation failure — because the
  // preAction hook does not fire there.
  const root = program();
  const script = child(root, "script");
  for (const verb of DEPRECATED_ALIASES) {
    const alias = child(root, verb);
    assert.ok(
      alias.description().startsWith(child(script, verb).description()),
      `${verb}: alias description should extend the namespaced one`
    );
    assert.match(alias.description(), new RegExp(`deprecated: use \`b6p script ${verb}\``));
    assert.match(alias.helpInformation(), /deprecated/, `${verb}: --help must show the notice`);
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
