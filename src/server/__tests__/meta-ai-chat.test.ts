import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyMetaAiMessage, extractCommand, isMetaAiId } from "../infrastructure/meta-ai-chat.js";
import type { RawMessage } from "../infrastructure/own-chat.js";

const META = "13135550002@c.us";
const msg = (over: Partial<RawMessage> = {}): RawMessage => ({
  id: "false_meta_1", fromMe: false, type: "chat", body: "/help", chat: META, to: "5493426397127@c.us", from: META, t: 1100, source: "event", ...over,
});

test("recognizes Meta AI under its different IDs", () => {
  for (const id of ["13135550002@c.us", "13135550002@lid.us", "13135550002@bot", "13135550002"]) assert.equal(isMetaAiId(id), true);
  assert.equal(isMetaAiId("5493426397127@c.us"), false);
  assert.equal(isMetaAiId(""), false);
});

test("extracts the command Meta AI repeats, ignoring its formatting", () => {
  assert.equal(extractCommand("/help"), "/help");
  assert.equal(extractCommand("`/pr 16`"), "/pr 16");
  assert.equal(extractCommand("“/approve repo#16”."), "/approve repo#16");
  assert.equal(extractCommand("*/yes*"), "/yes");
  assert.equal(extractCommand("Sure! Here it is:\n\n/routine fix the login bug"), "/routine fix the login bug");
  assert.equal(extractCommand("I can't help with that."), null);
  assert.equal(extractCommand("Use a / to start"), null);
});

test("accepts new Meta AI replies holding a command", () => {
  assert.deepEqual(classifyMetaAiMessage(msg(), 1000), { accept: true, text: "/help" });
  assert.deepEqual(classifyMetaAiMessage(msg({ chat: "13135550002@lid.us", from: "13135550002@lid.us", body: "`/prs`" }), 1000), { accept: true, text: "/prs" });
});

test("ignores your own message to Meta AI, history, other chats and replies without a command", () => {
  assert.equal(classifyMetaAiMessage(msg({ fromMe: true }), 1000).accept, false);
  assert.equal(classifyMetaAiMessage(msg({ t: 900 }), 1000).accept, false);
  assert.equal(classifyMetaAiMessage(msg({ chat: "111@c.us", from: "111@c.us" }), 1000).accept, false);
  assert.equal(classifyMetaAiMessage(msg({ body: "Hello! How can I help?" }), 1000).accept, false);
  assert.equal(classifyMetaAiMessage(msg({ body: "" }), 1000).accept, false);
});
