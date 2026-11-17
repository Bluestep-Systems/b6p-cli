// The standalone-binary smoke check must be able to fail: it has to look at the "Commands:" list,
// not at any mention of the word in option text.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const MODULE = pathToFileURL(path.join(__dirname, "..", "scripts", "helpListsCommand.mjs")).href;

const WITH_SCRIPT = `Usage: b6p [options] [command]

Options:
  --yes           Answer every confirmation (see script push --overwrite)

Commands:
  script          Manage script trees on the platform
  auth            Manage credentials
  help [command]  display help for command
`;

const WITHOUT_SCRIPT = WITH_SCRIPT.replace("  script          Manage script trees on the platform\n", "");

test("the smoke check finds the script command in the Commands section", async () => {
  const { helpListsCommand } = (await import(MODULE)) as { helpListsCommand(h: string, n: string): boolean };
  assert.equal(helpListsCommand(WITH_SCRIPT, "script"), true);
});

test("the smoke check fails when script is missing even though option text mentions it", async () => {
  const { helpListsCommand } = (await import(MODULE)) as { helpListsCommand(h: string, n: string): boolean };
  assert.match(WITHOUT_SCRIPT, /script push/, "fixture must still contain the word elsewhere");
  assert.equal(helpListsCommand(WITHOUT_SCRIPT, "script"), false);
});
