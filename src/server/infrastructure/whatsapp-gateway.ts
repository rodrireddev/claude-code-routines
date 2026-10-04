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

const MAX_TRACKED_IDS = 500;
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
        disableWelcome: true,
        updatesLog: false,
        logQR: false,
      });
      this.#client = client;
      await this.#loadOwnIds(client);
      client.onAnyMessage((message: Message) => void this.#dispatch(client, message));
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
        return;
      } catch (e) {
        lastError = e;
        console.warn(`[WhatsApp] could not send to ${target}: ${(e as Error)?.message ?? e}`);
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
    console.log(`[WhatsApp] connected. Own chat IDs: ${[...this.#ownIds].join(", ") || "(unknown)"}`);
  }

  /** Keeps only text messages the owner wrote in their own chat, excluding the bot's replies. */
  /** Hands self-chat messages to the bot. Errors are logged, never thrown (they would crash the server). */
  async #dispatch(client: Whatsapp, message: Message): Promise<void> {
    try {
      const incoming = await this.#toIncoming(client, message);
      if (!incoming) return;
      console.log(`[WhatsApp] command received: ${incoming.text.slice(0, 60)}`);
      for (const handler of this.#handlers) await handler(incoming);
    } catch (e) {
      console.error("[WhatsApp] error handling a message:", e);
    }
  }

  /** Keeps only text messages the owner wrote in their own chat, excluding the bot's replies. */
  async #toIncoming(client: Whatsapp, message: Message): Promise<IncomingMessage | null> {
    if (!message) return null;
    const body = (message.body ?? (message as { content?: string }).content ?? "").trim();
    const to = serialize(message.to) || serialize(message.chatId);
    const from = serialize(message.from);
    // Every message that looks like a command is logged with the reason it is (not) handled,
    // so problems can be diagnosed from the server console.
    const looksLikeCommand = body.startsWith("/");
    const skip = (reason: string): null => {
      if (looksLikeCommand) console.log(`[WhatsApp] ignored "${body.slice(0, 30)}" (from ${from} to ${to}, type ${message.type}): ${reason}`);
      return null;
    };
    if (!message.fromMe) return skip("not written by you");
    if (this.#sentIds.has(serialize(message.id))) return null;
    if (!body) return null;
    if (message.type !== "chat") return skip("not a text message");
    if (!(await this.#isOwnChat(client, to, from))) return skip("not your own chat");
    return { chatId: to, text: body };
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

  #setState(state: WhatsAppState): void {
    this.#state = state;
  }
}

/** WPPConnect message IDs come as strings or as { _serialized } objects depending on the event. */
function serialize(id: unknown): string {
  if (typeof id === "string") return id;
  return (id as { _serialized?: string } | null)?._serialized ?? "";
}
