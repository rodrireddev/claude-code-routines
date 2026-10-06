import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_COMMANDS } from "../../shared/commands.js";
import { SecureStore } from "../infrastructure/secure-store.js";
import { BotSettingsService, type BotSettings } from "../services/bot-settings.js";

function withStore(run: (store: SecureStore<BotSettings>) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "bot-settings-"));
  try {
    run(new SecureStore<BotSettings>(dir, "bot", "x".repeat(32)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("settings saved before /merge existed get the /merge command added once", () => {
  withStore((store) => {
    store.write({ githubToken: "t", commands: DEFAULT_COMMANDS.filter((c) => c.action !== "merge_pr") });
    const service = new BotSettingsService(store);
    assert.equal(service.get().commands.filter((c) => c.action === "merge_pr").length, 1);
    assert.equal(service.get().githubToken, "t");
    assert.equal(new BotSettingsService(store).get().commands.filter((c) => c.action === "merge_pr").length, 1);
  });
});

test("a user-defined /merge trigger is not overridden", () => {
  withStore((store) => {
    const commands = DEFAULT_COMMANDS.filter((c) => c.action !== "merge_pr").map((c) => c.action === "help" ? { ...c, trigger: "/merge" } : c);
    store.write({ githubToken: "", commands });
    assert.equal(new BotSettingsService(store).get().commands.some((c) => c.action === "merge_pr"), false);
  });
});
