import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import wweb from "whatsapp-web.js";
import type { ChatGateway, IncomingMessage } from "../bot/ports.js";

const { Client, LocalAuth } = wweb;
type WClient = InstanceType<typeof Client>;
type WMessage = wweb.Message;

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
  /** Chrome/Chromium to drive. Defaults to the one Puppeteer downloads on `npm install`. */
  browserPath?: string;
}

type MessageHandler = (msg: IncomingMessage) => void | Promise<void>;

const MAX_TRACKED_IDS = 500;
const CLIENT_ID = "routine-chat";

/**
 * WhatsApp connection through whatsapp-web.js, which drives a headless Chrome running WhatsApp Web
 * (Puppeteer) and is linked to the phone by scanning a QR code.
 *
 * Security: only messages the account owner writes in their own chat ("Message yourself") reach
 * the bot. Messages from other people or groups are ignored, so nobody else can run commands.
 * The browser session (WhatsApp credentials) is stored in DATA_DIR/whatsapp-session: protect it.
 */
export class WhatsAppGateway implements ChatGateway {
  readonly #sessionDir: string;
  readonly #browserPath: string | undefined;
  #client: WClient | null = null;
  #state: WhatsAppState;
  #handlers: MessageHandler[] = [];
  /** IDs of messages the bot sent, so its own replies are never treated as commands. */
  #sentIds = new Set<string>();
  /** The account's own chat IDs (phone-based "…@c.us" and, on newer accounts, "…@lid"). */
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
    return existsSync(join(this.#sessionDir, `session-${CLIENT_ID}`));
  }

  onMessage(handler: MessageHandler): void {
    this.#handlers.push(handler);
  }

  /** Starts the headless browser. Shows a QR code if the device is not linked yet. */
  async connect(): Promise<void> {
    if (this.#state.status === "disabled" || this.#client) return;
    this.#setState({ status: "connecting" });
    // The session folder holds WhatsApp credentials: only the current user may read it.
    mkdirSync(this.#sessionDir, { recursive: true, mode: 0o700 });
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: CLIENT_ID, dataPath: this.#sessionDir }),
      puppeteer: {
        headless: true,
        ...(this.#browserPath ? { executablePath: this.#browserPath } : {}),
        // --no-sandbox is needed in most containers; the page only loads web.whatsapp.com.
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      },
    });
    this.#client = client;

    client.on("qr", (qr: string) => {
      void QRCode.toDataURL(qr, { margin: 1, width: 280 }).then((url) => this.#setState({ status: "qr", qr: url }));
    });
    client.on("authenticated", () => this.#setState({ status: "connecting" }));
    client.on("ready", async () => {
      const me = client.info?.wid?._serialized;
      this.#ownIds = new Set(me ? [me] : []);
      try {
        // Newer accounts address the self chat by LID instead of phone number.
        for (const { lid, pn } of await client.getContactLidAndPhone(me ? [me] : [])) [lid, pn].forEach((id) => id && this.#ownIds.add(id));
      } catch { /* older WhatsApp Web versions have no LIDs */ }
      this.#setState({ status: "connected", account: client.info?.wid?.user });
    });
    client.on("auth_failure", (message: string) => {
      this.#setState({ status: "disconnected", error: `Authentication failed: ${message}` });
      void this.#shutdown(true);
    });
    client.on("disconnected", (reason: string) => {
      // LOGOUT means the device was unlinked from the phone: the stored session is no longer valid.
      const unlinked = reason === "LOGOUT";
      this.#setState({ status: "disconnected", error: unlinked ? "The device was unlinked from WhatsApp." : `Disconnected: ${reason}` });
      void this.#shutdown(unlinked);
    });
    // "message_create" also fires for messages the owner sends, which is what the self chat needs.
    client.on("message_create", (message: WMessage) => {
      const incoming = this.#toIncoming(message);
      if (incoming) for (const handler of this.#handlers) void handler(incoming);
    });

    try {
      await client.initialize();
    } catch (e) {
      this.#setState({ status: "disconnected", error: `Could not start WhatsApp Web: ${(e as Error).message}` });
      await this.#shutdown(false); // close the browser that was launched
    }
  }

  async send(chatId: string, text: string): Promise<void> {
    if (!this.#client || this.#state.status !== "connected") throw new Error("WhatsApp is not connected");
    const sent = await this.#client.sendMessage(chatId, text);
    this.#sentIds.add(sent.id._serialized);
    if (this.#sentIds.size > MAX_TRACKED_IDS) this.#sentIds.delete(this.#sentIds.values().next().value!);
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

  /** Keeps only text messages the owner wrote in their own chat, excluding the bot's replies. */
  #toIncoming(message: WMessage): IncomingMessage | null {
    if (!message.fromMe || message.type !== "chat" || !message.body) return null;
    if (this.#sentIds.has(message.id._serialized)) return null;
    // In the "Message yourself" chat the recipient is the account itself.
    if (message.from !== message.to && !this.#ownIds.has(message.to)) return null;
    return { chatId: message.to, text: message.body };
  }

  async #shutdown(clearSession: boolean): Promise<void> {
    const client = this.#client;
    this.#client = null;
    try {
      await client?.destroy();
    } catch { /* browser already closed */ }
    if (clearSession) rmSync(this.#sessionDir, { recursive: true, force: true });
  }

  #setState(state: WhatsAppState): void {
    this.#state = state;
  }
}
