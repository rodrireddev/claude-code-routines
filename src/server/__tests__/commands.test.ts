import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_COMMANDS, normalizeTrigger, parseCommand, parsePullRef, validateCommands } from "../../shared/commands.js";

test("parseCommand accepts spaces, # and no arguments", () => {
  assert.deepEqual(parseCommand("/pr 16"), { trigger: "/pr", args: "16" });
  assert.deepEqual(parseCommand("/pr#16"), { trigger: "/pr", args: "#16" });
  assert.deepEqual(parseCommand("  /PRS  "), { trigger: "/prs", args: "" });
  assert.deepEqual(parseCommand("/routine1 create a branch\nand fix it"), { trigger: "/routine1", args: "create a branch\nand fix it" });
  assert.equal(parseCommand("just a note"), null);
  assert.equal(parseCommand("/"), null);
});

test("parsePullRef understands numbers, repo refs and URLs", () => {
  assert.deepEqual(parsePullRef("16"), { repo: "", number: 16 });
  assert.deepEqual(parsePullRef("#16"), { repo: "", number: 16 });
  assert.deepEqual(parsePullRef("game#16"), { repo: "game", number: 16 });
  assert.deepEqual(parsePullRef("me/game#16"), { repo: "me/game", number: 16 });
  assert.deepEqual(parsePullRef("https://github.com/me/game/pull/16"), { repo: "me/game", number: 16 });
  assert.equal(parsePullRef("abc"), null);
});

test("normalizeTrigger and validateCommands", () => {
  assert.equal(normalizeTrigger("PRS"), "/prs");
  assert.equal(normalizeTrigger("/bad trigger"), null);
  assert.equal(validateCommands(DEFAULT_COMMANDS), null);
  assert.match(validateCommands([...DEFAULT_COMMANDS, { ...DEFAULT_COMMANDS[0], id: "x" }])!, /Duplicate/);
});
