import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { create, type Message, type Whatsapp } from "@wppconnect-team/wppconnect";
import puppeteer, { type Browser, type LaunchOptions } from "puppeteer";
import type { ChatGateway, IncomingMessage } from "../bot/ports.js";

export type WhatsAppStatus = "disabled" | "disconnected" | "connecting" | "qr" | "connected";

export interface WhatsAppState {
  status: WhatsAppStatus;
  /** QR code to scan, as a PNG data URL (only while status is "qr"). */
  qr?: string;
  /** Phone number of the linked account. */
  account?: string;
  error?: string;
}

export interface WhatsAppOptions {
  dataDir: string;
  enabled: boolean;
  /** Chrome/Chromium to drive. Defaults to the installed Google Chrome, then to Puppeteer's own. */
  browserPath?: string;
}

type MessageHandler = (msg: IncomingMessage) => void | Promise<void>;

/** One line of the activity log shown in the UI (and printed to the console) to diagnose the bot. */
export interface ActivityEntry {
  at: string;
  kind: "info" | "seen" | "received" | "ignored" | "sent" | "error";
  text: string;
}

const MAX_ACTIVITY = 60;

const MAX_TRACKED_IDS = 500;
const POLL_INTERVAL_MS = 3000;

/** A message as the gateway sees it, whatever WhatsApp Web object it came from. */
interface RawMessage {
  id: string;
  fromMe: boolean;
  type: string;
  body: string;
  to: string;
  from: string;
  /** Unix time in seconds (0 if unknown). */
  t: number;
  source?: "event" | "store" | "poll";
}

/** Shape of WhatsApp Web's internal message model (only the fields we read, inside the page). */
interface RawMsgModel {
  id?: { fromMe?: boolean; _serialized: string; remote?: { _serialized: string } };
  type: string;
  body?: string;
  to?: { _serialized: string };
  from?: { _serialized: string };
  t?: number;
}
const SESSION = "routine-chat";

/** WPPConnect statuses that mean the session ended. */
const ENDED = new Set(["browserClose", "autocloseCalled", "disconnectedMobile", "deleteToken", "serverClose"]);
/** Statuses after which the stored session is no longer valid (unlinked from the phone). */
const UNLINKED = new Set(["disconnectedMobile", "deleteToken"]);

/**
 * WhatsApp connection through WPPConnect: it drives a Chrome running WhatsApp Web (Puppeteer),
 * linked to the phone by scanning a QR code. Same setup as rodrireddev/companion-ai
 * (`useChrome`, `autoClose: 0`, `catchQR` → image for the UI, `onAnyMessage` + `sendText`).
 *
 * Security: only messages the account owner writes in their own chat ("Message yourself") reach
 * the bot. Messages from other people or groups are ignored, so nobody else can run commands.
 * The browser profile (WhatsApp credentials) lives in DATA_DIR/whatsapp-session: protect it.
 */
export class WhatsAppGateway implements ChatGateway {
  readonly #sessionDir: string;
  readonly #browserPath: string | undefined;
  #client: Whatsapp | null = null;
  #browser: Browser | null = null;
  #starting = false;
  #state: WhatsAppState;
  #handlers: MessageHandler[] = [];
  /** IDs of messages the bot sent, so its own replies are never treated as commands. */
  #sentIds = new Set<string>();
  #activity: ActivityEntry[] = [];
  /** Last poll diagnostics, to log only when they change. */
  #lastPollDiag = "";
  /** Messages already handled (they can arrive through several sources). */
  #processed = new Set<string>();
  /** Unix time (s) of the connection: older messages are history, not commands. */
  #connectedAt = 0;
  #pollTimer: NodeJS.Timeout | null = null;
  #polling = false;
  /** The account's own chat IDs ("…@c.us" and, on newer accounts, "…@lid"). */
  #ownIds = new Set<string>();

  constructor(options: WhatsAppOptions) {
    this.#sessionDir = join(options.dataDir, "whatsapp-session");
    this.#browserPath = options.browserPath;
    this.#state = { status: options.enabled ? "disconnected" : "disabled" };
  }

  get state(): WhatsAppState {
    return { ...this.#state };
  }

  /** True if a device was linked before (the connection can resume without a new QR). */
  hasSession(): boolean {
    return existsSync(this.#linkedMarker);
  }

  /** Written once WhatsApp is connected, so startup only resumes sessions that were really linked. */
  get #linkedMarker(): string {
    return join(this.#sessionDir, ".linked");
  }

  /** Most recent first. */
  get activity(): ActivityEntry[] {
    return [...this.#activity].reverse();
  }

  /** Sends a test message to the own chat: checks the sending path independently of commands. */
  async sendTest(): Promise<void> {
    const target = [...this.#ownIds].find((id) => id.endsWith("@lid")) ?? [...this.#ownIds][0];
    if (!target) throw new Error("Own chat unknown: is WhatsApp connected?");
    await this.send(target, "🤖 Test message from Routine Chat ✅ — sending works. Now try /help");
  }

  onMessage(handler: MessageHandler): void {
    this.#handlers.push(handler);
  }

  /** Starts WhatsApp Web in a headless Chrome. Shows a QR code if the device is not linked yet. */
  async connect(): Promise<void> {
    if (this.#state.status === "disabled" || this.#client || this.#starting) return;
    this.#starting = true;
    this.#setState({ status: "connecting" });
    // The session folder holds WhatsApp credentials: only the current user may read it.
    mkdirSync(this.#sessionDir, { recursive: true, mode: 0o700 });
    try {
      // The app launches (and therefore can always close) the browser, then hands it to WPPConnect.
      this.#browser = await this.#launchBrowser();
      const client = await create({
        session: SESSION,
        browser: this.#browser,
        folderNameToken: this.#sessionDir,
        catchQR: (base64Qr: string) => {
          const qr = base64Qr.startsWith("data:") ? base64Qr : `data:image/png;base64,${base64Qr}`;
          this.#setState({ status: "qr", qr });
        },
        statusFind: (status: string) => this.#onStatus(status),
        headless: true,
        // Wait for the QR scan as long as needed (WPPConnect closes after ~60 s by default).
        autoClose: 0,
        // Also don't close the page if the first sync with the phone takes more than 3 minutes.
        deviceSyncTimeout: 0,
        disableWelcome: true,
        updatesLog: false,
        logQR: false,
      });
      this.#client = client;
      await this.#loadOwnIds(client);
      this.#connectedAt = Math.floor(Date.now() / 1000) - 5;
      client.onAnyMessage((message: Message) => void this.#dispatch(client, fromWppMessage(message)));
      await this.#watchOwnChat(client);
      // If WhatsApp Web is opened somewhere else, take the session back.
      client.onStateChange((state) => {
        if (String(state) === "CONFLICT") void client.useHere().catch(() => undefined);
      });
      const wid = await client.getWid().catch(() => "");
      writeFileSync(this.#linkedMarker, new Date().toISOString(), { mode: 0o600 });
      this.#setState({ status: "connected", account: wid.split("@")[0] });
    } catch (e) {
      this.#setState({ status: "disconnected", error: `Could not start WhatsApp Web: ${(e as Error).message ?? e}` });
      await this.#shutdown(false);
    } finally {
      this.#starting = false;
    }
  }

  /**
   * Replies in the user's own chat. Sending to a "…@lid" ID can fail on some WhatsApp Web versions,
   * so the phone-based ID ("…@c.us") of the same chat is tried as a fallback.
   */
  async send(chatId: string, text: string): Promise<void> {
    const client = this.#client;
    if (!client || this.#state.status !== "connected") throw new Error("WhatsApp is not connected");
    const targets = [...new Set([chatId, ...[...this.#ownIds].filter((id) => id.endsWith("@c.us"))])];
    let lastError: unknown;
    for (const target of targets) {
      try {
        const sent = await client.sendText(target, text);
        this.#track(sent?.id);
        this.#log("sent", `reply sent to ${target}: "${text.slice(0, 40).replace(/\n/g, " ")}…"`);
        return;
      } catch (e) {
        lastError = e;
        this.#log("error", `could not send to ${target}: ${(e as Error)?.message ?? e}`);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /** Unlinks the device from WhatsApp and deletes the stored session. */
  async logout(): Promise<void> {
    try {
      if (this.#state.status === "connected") await this.#client?.logout();
    } catch { /* already gone */ }
    await this.#shutdown(true);
    if (this.#state.status !== "disabled") this.#setState({ status: "disconnected" });
  }

  /** Closes the browser but keeps the session (used on server shutdown). */
  async stop(): Promise<void> {
    await this.#shutdown(false);
  }

  /** Headless Chrome with a persistent profile (that profile is what keeps WhatsApp linked). */
  async #launchBrowser(): Promise<Browser> {
    const options: LaunchOptions = {
      headless: true,
      userDataDir: join(this.#sessionDir, SESSION),
      // --no-sandbox is needed in most containers; the page only loads web.whatsapp.com.
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    };
    if (this.#browserPath) return puppeteer.launch({ ...options, executablePath: this.#browserPath });
    try {
      return await puppeteer.launch({ ...options, channel: "chrome" }); // installed Google Chrome, like companion-ai
    } catch {
      return puppeteer.launch(options); // Chrome downloaded by Puppeteer on npm install
    }
  }

  #onStatus(status: string): void {
    this.#log("info", `WhatsApp Web status: ${status}`);
    if (status === "qrReadSuccess" || status === "isLogged") this.#setState({ status: "connecting" });
    if (status === "qrReadFail") this.#setState({ status: "disconnected", error: "The QR code was not scanned in time." });
    if (ENDED.has(status) && !this.#starting) {
      const unlinked = UNLINKED.has(status);
      this.#setState({ status: "disconnected", error: unlinked ? "The device was unlinked from WhatsApp." : `Disconnected (${status}).` });
      void this.#shutdown(unlinked);
    }
  }

  /** Own phone ID plus the LID newer accounts use to address the "Message yourself" chat. */
  async #loadOwnIds(client: Whatsapp): Promise<void> {
    this.#ownIds = new Set();
    const wid = await client.getWid().catch(() => "");
    if (wid) this.#ownIds.add(wid);
    try {
      const lid = await client.page.evaluate(() => {
        const wpp = (globalThis as unknown as { WPP?: { conn?: { getMyUserLid?: () => { toString(): string } | undefined } } }).WPP;
        return wpp?.conn?.getMyUserLid?.()?.toString() ?? "";
      });
      if (lid) this.#ownIds.add(lid);
    } catch { /* older WhatsApp Web versions have no LIDs */ }
    this.#log("info", `connected. Own chat IDs: ${[...this.#ownIds].join(", ") || "(unknown)"}`);
  }

  /**
   * Single entry point for messages, whatever the source (WPPConnect event, store listener or poll).
   * Each message is handled once. Errors are logged, never thrown (they would crash the server).
   */
  async #dispatch(client: Whatsapp, message: RawMessage): Promise<void> {
    if (!message.id || this.#processed.has(message.id)) return;
    // Not-yet-decrypted messages ("ciphertext") come back later as "chat": only mark final ones.
    if (message.type === "chat") this.#processed.add(message.id);
    if (this.#processed.size > MAX_TRACKED_IDS * 2) this.#processed.delete(this.#processed.values().next().value!);
    try {
      const incoming = await this.#toIncoming(client, message);
      if (!incoming) return;
      this.#log("received", `"${incoming.text.slice(0, 60)}" (via ${message.source})`);
      for (const handler of this.#handlers) await handler(incoming);
    } catch (e) {
      this.#log("error", `handling a message failed: ${(e as Error)?.message ?? e}`);
    }
  }

  /** Keeps only text messages the owner wrote in their own chat, excluding the bot's replies. */
  async #toIncoming(client: Whatsapp, message: RawMessage): Promise<IncomingMessage | null> {
    const body = message.body.trim();
    // Every message that looks like a command is logged with the reason it is (not) handled,
    // so problems can be diagnosed from the server console.
    const skip = (reason: string): null => {
      if (body.startsWith("/") || this.#ownIds.has(message.to)) {
        this.#log("ignored", `"${body.slice(0, 30)}" (via ${message.source}, from ${message.from} to ${message.to}, type ${message.type}): ${reason}`);
      }
      return null;
    };
    if (!message.fromMe) return skip("not written by you");
    if (this.#sentIds.has(message.id) || body.startsWith("🤖")) return null; // the bot's own replies
    if (!body) return null;
    if (message.type !== "chat") return skip("not a text message");
    if (message.t && message.t < this.#connectedAt) return null; // history from before connecting
    if (!(await this.#isOwnChat(client, message.to, message.from))) return skip("not your own chat");
    return { chatId: message.to, text: body };
  }

  /**
   * WPPConnect's onAnyMessage only fires for messages WhatsApp Web flags as "new", and messages
   * typed on the phone in your own chat may arrive synced without that flag. So we also listen to
   * WhatsApp Web's message store directly, and poll the own chat every few seconds as a backstop.
   */
  async #watchOwnChat(client: Whatsapp): Promise<void> {
    const page = client.page;
    try {
      await page.exposeFunction("routineChatMessage", (m: RawMessage) => void this.#dispatch(client, { ...m, source: "store" }));
      await page.evaluate(() => {
        const w = globalThis as unknown as {
          WPP: { whatsapp: { MsgStore: { on(event: string, cb: (msg: RawMsgModel) => void): void } } };
          routineChatMessage(m: unknown): void;
        };
        const send = (msg: RawMsgModel): void => {
          if (!msg?.id?.fromMe) return;
          w.routineChatMessage({
            id: msg.id._serialized, fromMe: true, type: msg.type, body: msg.body ?? "",
            to: msg.to?._serialized ?? msg.id.remote?._serialized ?? "", from: msg.from?._serialized ?? "", t: msg.t ?? 0,
          });
        };
        w.WPP.whatsapp.MsgStore.on("add", send);
        // Encrypted messages are added first as "ciphertext" and become "chat" once decrypted.
        w.WPP.whatsapp.MsgStore.on("change:type", send);
      });
      this.#log("info", "listening to the message store");
    } catch (e) {
      this.#log("error", `could not attach the message-store listener: ${(e as Error).message}`);
    }

    this.#pollTimer = setInterval(() => void this.#pollOwnChat(client), POLL_INTERVAL_MS);
  }

  async #pollOwnChat(client: Whatsapp): Promise<void> {
    if (this.#polling || !this.#client) return;
    this.#polling = true;
    try {
      const { messages, diag } = await client.page.evaluate(async (chatIds: string[]) => {
        const w = globalThis as unknown as { WPP: { chat: { getMessages(id: string, o: { count: number }): Promise<RawMsgModel[]> } } };
        const out: unknown[] = [];
        const notes: string[] = [];
        for (const chatId of chatIds) {
          try {
            const msgs = await w.WPP.chat.getMessages(chatId, { count: 5 });
            notes.push(`${chatId}: ok`);
            for (const msg of msgs) {
              if (!msg?.id?.fromMe) continue;
              out.push({
                id: msg.id._serialized, fromMe: true, type: msg.type, body: msg.body ?? "",
                to: msg.to?._serialized ?? chatId, from: msg.from?._serialized ?? "", t: msg.t ?? 0,
              });
            }
          } catch (e) {
            notes.push(`${chatId}: ${(e as Error)?.message ?? e}`);
          }
        }
        return { messages: out as RawMessage[], diag: notes.join(" · ") };
      }, [...this.#ownIds]);
      if (diag !== this.#lastPollDiag) {
        this.#lastPollDiag = diag;
        this.#log("info", `own-chat check: ${diag}`);
      }
      for (const m of messages) await this.#dispatch(client, { ...m, source: "poll" });
    } catch (e) {
      const diag = `failed: ${(e as Error)?.message ?? e}`;
      if (diag !== this.#lastPollDiag) {
        this.#lastPollDiag = diag;
        this.#log("error", `own-chat check ${diag}`);
      }
    } finally {
      this.#polling = false;
    }
  }

  /**
   * "Message yourself" chat? Depending on the account it is addressed by phone ("…@c.us") or by
   * LID ("…@lid"), so besides the known IDs we ask WhatsApp whether the contact is the account itself.
   */
  async #isOwnChat(client: Whatsapp, to: string, from: string): Promise<boolean> {
    if (!to) return false;
    if (to === from || this.#ownIds.has(to)) return true;
    if (to.endsWith("@g.us") || to.endsWith("@broadcast") || to.endsWith("@newsletter")) return false;
    try {
      const contact = await client.getContact(to);
      if (contact?.isMe) {
        this.#ownIds.add(to);
        return true;
      }
    } catch { /* unknown contact */ }
    return false;
  }

  #track(id: unknown): void {
    const key = serialize(id);
    if (!key) return;
    this.#sentIds.add(key);
    if (this.#sentIds.size > MAX_TRACKED_IDS) this.#sentIds.delete(this.#sentIds.values().next().value!);
  }

  async #shutdown(clearSession: boolean): Promise<void> {
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    this.#pollTimer = null;
    const client = this.#client;
    const browser = this.#browser;
    this.#client = null;
    this.#browser = null;
    try {
      await client?.close();
    } catch { /* already closed */ }
    try {
      await browser?.close();
    } catch { /* already closed */ }
    if (clearSession) rmSync(this.#sessionDir, { recursive: true, force: true });
  }

  #log(kind: ActivityEntry["kind"], text: string): void {
    this.#activity.push({ at: new Date().toISOString(), kind, text });
    if (this.#activity.length > MAX_ACTIVITY) this.#activity.shift();
    (kind === "error" ? console.error : console.log)(`[WhatsApp] ${kind}: ${text}`);
  }

  #setState(state: WhatsAppState): void {
    this.#state = state;
  }
}

function fromWppMessage(message: Message): RawMessage {
  return {
    id: serialize(message?.id),
    fromMe: !!message?.fromMe,
    type: message?.type ?? "",
    body: message?.body ?? (message as { content?: string })?.content ?? "",
    to: serialize(message?.to) || serialize(message?.chatId),
    from: serialize(message?.from),
    t: message?.t ?? 0,
    source: "event",
  };
}

/** WPPConnect message IDs come as strings or as { _serialized } objects depending on the event. */
function serialize(id: unknown): string {
  if (typeof id === "string") return id;
  return (id as { _serialized?: string } | null)?._serialized ?? "";
}
