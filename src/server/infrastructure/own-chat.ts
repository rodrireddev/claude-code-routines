/**
 * Decides whether a WhatsApp message is a command the owner typed in their own chat
 * ("Message yourself"). Pure function, so it is unit-tested without WhatsApp.
 *
 * Background (wa-js ≥ 2.25): messages sent from another linked device (your phone) often arrive
 * without `isNewMsg`, may first appear as "ciphertext" with an empty body, and their `to`/`from`
 * can be rewritten with LIDs. The chat itself is identified reliably by `id.remote`.
 */

export interface RawMessage {
  id: string;
  fromMe: boolean;
  type: string;
  body: string;
  /** `id.remote`: the chat the message belongs to. */
  chat: string;
  to: string;
  from: string;
  /** Unix time in seconds (0 if unknown). */
  t: number;
  source?: "event" | "store" | "poll";
}

export interface OwnChatContext {
  /** The account's own IDs ("…@c.us" and "…@lid"). */
  ownIds: ReadonlySet<string>;
  /** IDs of messages the bot sent. */
  sentIds: ReadonlySet<string>;
  /** Unix time (s) of the connection; older messages are history. */
  connectedAt: number;
}

export type Classification =
  | { accept: true; chatId: string; text: string }
  /** `log`: worth showing in the activity log (looks like a command or is in the own chat). */
  | { accept: false; reason: string; log: boolean; unknownChat?: boolean };

const GROUP_LIKE = ["@g.us", "@broadcast", "@newsletter"];

export function classifyMessage(m: RawMessage, ctx: OwnChatContext): Classification {
  const body = m.body.trim();
  const chat = m.chat || m.to;
  const inOwnChat = ctx.ownIds.has(chat) || ctx.ownIds.has(m.to);
  const log = body.startsWith("/") || inOwnChat;
  const reject = (reason: string, extra: Partial<{ unknownChat: boolean }> = {}): Classification =>
    ({ accept: false, reason, log, ...extra });

  if (m.fromMe !== true) return reject("not written by you");
  if (ctx.sentIds.has(m.id) || body.startsWith("🤖")) return { accept: false, reason: "bot reply", log: false };
  if (!body) return { accept: false, reason: "no text yet", log: false };
  if (m.type !== "chat") return reject("not a text message");
  if (m.t && m.t < ctx.connectedAt) return { accept: false, reason: "history", log: false };
  if (!chat || GROUP_LIKE.some((suffix) => chat.endsWith(suffix))) return reject("not your own chat");
  if (!inOwnChat) return reject("not your own chat", { unknownChat: true });
  return { accept: true, chatId: chat, text: body };
}
