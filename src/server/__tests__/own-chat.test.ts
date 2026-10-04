import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyMessage, type RawMessage } from "../infrastructure/own-chat.js";

const PHONE = "5493426397127@c.us";
const LID = "201855309217843@lid";
const ctx = { ownIds: new Set([PHONE, LID]), sentIds: new Set(["true_bot_1"]), connectedAt: 1000 };

const msg = (over: Partial<RawMessage> = {}): RawMessage => ({
  id: "true_x_1", fromMe: true, type: "chat", body: "/help", chat: LID, to: LID, from: PHONE, t: 1100, source: "store", ...over,
});

test("accepts a command typed on the phone in the own chat (LID chat, rewritten from/to)", () => {
  assert.deepEqual(classifyMessage(msg(), ctx), { accept: true, chatId: LID, text: "/help" });
  // to/from rewritten to the phone number: the chat (id.remote) still identifies the own chat
  assert.deepEqual(classifyMessage(msg({ to: PHONE, from: PHONE }), ctx), { accept: true, chatId: LID, text: "/help" });
  // phone-based own chat on older accounts
  assert.deepEqual(classifyMessage(msg({ chat: PHONE, to: PHONE }), ctx), { accept: true, chatId: PHONE, text: "/help" });
  // plain answers (yes/no confirmations) in the own chat are accepted too
  assert.equal(classifyMessage(msg({ body: "yes" }), ctx).accept, true);
});

test("waits for encrypted messages instead of discarding them", () => {
  const cipher = classifyMessage(msg({ type: "ciphertext", body: "" }), ctx);
  assert.equal(cipher.accept, false);
  assert.equal(classifyMessage(msg({ body: "" }), ctx).accept, false);
});

test("rejects other chats, groups, incoming messages, history and the bot's own replies", () => {
  const other = classifyMessage(msg({ chat: "111@c.us", to: "111@c.us" }), ctx);
  assert.equal(other.accept, false);
  assert.equal(!other.accept && other.unknownChat, true, "unknown chats can be checked with WhatsApp");
  assert.equal(classifyMessage(msg({ chat: "123@g.us", to: "123@g.us" }), ctx).accept, false);
  assert.equal(classifyMessage(msg({ fromMe: false }), ctx).accept, false);
  assert.equal(classifyMessage(msg({ t: 900 }), ctx).accept, false);
  assert.equal(classifyMessage(msg({ id: "true_bot_1" }), ctx).accept, false);
  assert.equal(classifyMessage(msg({ body: "🤖 Available commands" }), ctx).accept, false);
});
