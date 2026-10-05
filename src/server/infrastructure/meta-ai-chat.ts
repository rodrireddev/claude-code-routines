/**
 * Commands through the Meta AI chat. Messages you type on your phone are unreliable to intercept
 * (WhatsApp Web often syncs them without the "new message" flag), but messages you *receive* are
 * reliable. So you ask Meta AI to repeat a command ("Repeat exactly: /help") and the bot runs the
 * command found in Meta AI's reply. Pure functions, unit-tested without WhatsApp.
 */
import type { RawMessage } from "./own-chat.js";

/** Meta AI's WhatsApp number (it appears as "…@c.us", "…@lid.us", "…@bot" depending on the version). */
export const META_AI_NUMBER = "13135550002";
/** Chat IDs tried when reading Meta AI's chat (same candidates as rodrireddev/companion-ai). */
export const META_AI_CHAT_IDS = [`${META_AI_NUMBER}@c.us`, `${META_AI_NUMBER}@lid.us`];

export function isMetaAiId(id: string | undefined): boolean {
  return !!id && id.split("@")[0] === META_AI_NUMBER;
}

/**
 * First line of a Meta AI reply that is a command ("/help", "/pr 16", "/yes"), ignoring the
 * formatting it may add (quotes, *bold*, `code`). Null when the reply has no command.
 */
export function extractCommand(body: string): string | null {
  for (const raw of body.split("\n")) {
    const line = raw.trim().replace(/^[\s"'“”‘’`*_>~]+|[\s"'“”‘’`*_~.!]+$/g, "");
    if (/^\/[a-z0-9]/i.test(line)) return line;
  }
  return null;
}

export type MetaAiClassification =
  | { accept: true; text: string }
  | { accept: false; reason: string; log: boolean };

/** Accepts new messages Meta AI sends that contain a command. */
export function classifyMetaAiMessage(m: RawMessage, connectedAt: number): MetaAiClassification {
  if (!isMetaAiId(m.chat) && !isMetaAiId(m.from)) return { accept: false, reason: "not the Meta AI chat", log: false };
  if (m.fromMe) return { accept: false, reason: "written by you (waiting for Meta AI to repeat it)", log: false };
  if (m.t && m.t < connectedAt) return { accept: false, reason: "history", log: false };
  const body = m.body.trim();
  if (!body) return { accept: false, reason: "no text yet", log: false };
  const command = extractCommand(body);
  if (!command) return { accept: false, reason: "Meta AI's reply has no /command", log: true };
  return { accept: true, text: command };
}
