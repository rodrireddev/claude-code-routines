import "./chat-message.js";
import "./chat-settings.js";
import "./conversation-list.js";
import "./pr-review.js";
import { t, type Key } from "./i18n.js";
import { store } from "./store.js";
import type { ChatMessage } from "./chat-message.js";
import type { FireResponse, Message, SlButton, SlTextarea } from "./types.js";

/** Messages saved by older versions stored Spanish text instead of a translation key. */
const LEGACY: Record<string, Key> = {
  "Ejecutando routine…": "msg.running",
  "Routine lanzada correctamente.": "msg.fired",
  "Interrumpido: no se recibió respuesta.": "msg.interrupted",
};

const messageText = (m: Message): string => {
  const key = m.key ?? LEGACY[m.text];
  return key ? t(key) : m.text;
};

/** <routine-chat> — aplicación completa: lista de conversaciones + chat de la activa. */
export class RoutineChat extends HTMLElement {
  #messages!: HTMLDivElement;
  #scroller!: HTMLElement;
  #settings!: HTMLElement & { show(): void };
  #title!: HTMLElement;
  #input!: SlTextarea;
  #send!: SlButton;
  /** Conversaciones con una petición en curso (la respuesta se guarda aunque cambies de conversación). */
  #busy = new Set<string>();

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host { display:flex; height:100%; }
        conversation-list { width:260px; flex:none; }
        main { flex:1; min-width:0; display:flex; flex-direction:column; position:relative; }
        header { display:flex; align-items:center; justify-content:space-between; gap:var(--sl-spacing-small); padding:var(--sl-spacing-x-small) var(--sl-spacing-medium); min-height:52px; }
        #title { font-weight:var(--sl-font-weight-semibold); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .actions { display:flex; }
        [hidden] { display:none !important; }
        sl-icon-button { font-size:var(--sl-font-size-large); color:var(--sl-color-neutral-600); }
        pr-review { display:none; }
        :host(.view-prs) pr-review { display:flex; }
        :host(.view-prs) #scroll, :host(.view-prs) .composer-wrap, :host(.view-prs) #lock, :host(.view-prs) #gear { display:none; }
        #scroll { flex:1; overflow-y:auto; }
        #messages { max-width:768px; margin:0 auto; padding:var(--sl-spacing-medium); display:flex; flex-direction:column; gap:var(--sl-spacing-large); }
        .empty { display:none; flex-direction:column; align-items:center; justify-content:center; gap:var(--sl-spacing-x-small); height:100%; color:var(--sl-color-neutral-500); text-align:center; padding:var(--sl-spacing-large); }
        .empty .logo { border-radius:50%; margin-bottom:var(--sl-spacing-x-small); }
        .empty h2 { margin:0; font-weight:var(--sl-font-weight-semibold); color:var(--sl-color-neutral-900); }
        :host(.is-empty) .empty { display:flex; }
        :host(.is-empty) #messages { display:none; }
        .composer-wrap { padding:0 var(--sl-spacing-medium) var(--sl-spacing-medium); }
        .composer { max-width:768px; margin:0 auto; display:flex; align-items:flex-end; gap:var(--sl-spacing-x-small); padding:var(--sl-spacing-x-small) var(--sl-spacing-x-small) var(--sl-spacing-x-small) var(--sl-spacing-medium); background:var(--sl-color-neutral-0); border:1px solid var(--sl-color-neutral-300); border-radius:var(--sl-border-radius-x-large); box-shadow:var(--sl-shadow-medium); }
        .composer:focus-within { border-color:var(--sl-color-neutral-400); }
        sl-textarea { flex:1; }
        sl-textarea::part(base) { border:none; background:transparent; box-shadow:none; }
        sl-textarea::part(textarea) { padding:var(--sl-spacing-x-small) 0; max-height:200px; }
        .send::part(base) { border-radius:50%; width:36px; height:36px; padding:0; }
        chat-message a { color:var(--sl-color-primary-600); }
        .hint { max-width:768px; margin:var(--sl-spacing-x-small) auto 0; text-align:center; font-size:var(--sl-font-size-x-small); color:var(--sl-color-neutral-500); }
      </style>
      <conversation-list></conversation-list>
      <main>
        <header>
          <div id="title"></div>
          <div class="actions">
            <sl-icon-button id="lock" name="lock" label="${t("chat.lock")}" hidden></sl-icon-button>
            <sl-icon-button id="gear" name="gear" label="${t("chat.settings")}"></sl-icon-button>
          </div>
        </header>
        <div id="scroll">
          <div class="empty"><img class="logo" src="/assets/logo-128.png" alt="" width="72" height="72" /><h2>${t("chat.emptyTitle")}</h2><div>${t("chat.emptyText")}</div></div>
          <div id="messages"></div>
        </div>
        <div class="composer-wrap">
          <div class="composer">
            <sl-textarea rows="1" resize="auto" placeholder="${t("chat.placeholder")}"></sl-textarea>
            <sl-button class="send" variant="primary" circle label="${t("chat.send")}"><sl-icon name="arrow-up" label="${t("chat.send")}"></sl-icon></sl-button>
          </div>
          <div class="hint">${t("chat.hint")}</div>
        </div>
        <pr-review></pr-review>
        <chat-settings></chat-settings>
      </main>`;
    const root = this.shadowRoot!;
    this.#title = root.getElementById("title")!;
    this.#messages = root.getElementById("messages") as HTMLDivElement;
    this.#scroller = root.getElementById("scroll")!;
    this.#settings = root.querySelector("chat-settings") as HTMLElement & { show(): void };
    this.#input = root.querySelector("sl-textarea") as SlTextarea;
    this.#send = root.querySelector("sl-button") as SlButton;
  }

  /** Detaches store/window listeners when the element is discarded (e.g. UI rebuilt after a language change). */
  #off = new AbortController();

  disconnectedCallback(): void {
    this.#off.abort();
  }

  connectedCallback(): void {
    this.#off = new AbortController();
    const root = this.shadowRoot!;
    const lock = root.getElementById("lock")!;
    root.getElementById("gear")!.addEventListener("click", () => this.#settings.show());
    lock.addEventListener("click", () => void store.lock());
    const list = root.querySelector("conversation-list")!;
    const setView = (prs: boolean): void => {
      this.classList.toggle("view-prs", prs);
      list.toggleAttribute("prs", prs);
      this.#renderTitle();
    };
    list.addEventListener("open-prs", () => setView(true));
    list.addEventListener("open-chat", () => setView(false));
    // A new conversation starts empty: open its settings so the trigger and token can be filled in.
    list.addEventListener("new-conversation", () => this.#settings.show());
    store.addEventListener("change", (e) => {
      if ((e as CustomEvent).detail === "active") setView(false);
    }, { signal: this.#off.signal });
    const syncLock = (): void => void (lock.hidden = !store.encrypted);
    store.addEventListener("security", syncLock, { signal: this.#off.signal });
    syncLock();
    this.#send.addEventListener("click", () => void this.#submit());
    this.#input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter" && !(e as KeyboardEvent).shiftKey) {
        e.preventDefault();
        void this.#submit();
      }
    });
    store.addEventListener("change", (e) => {
      const kind = (e as CustomEvent).detail;
      this.#renderTitle();
      if (kind !== "meta") this.#renderMessages();
      if (kind === "active" || kind === "list") this.#updateBusy();
    }, { signal: this.#off.signal });
    this.#renderTitle();
    this.#renderMessages();
  }

  #renderTitle(): void {
    this.#title.textContent = this.classList.contains("view-prs")
      ? t("chat.prTitle")
      : store.active.title || t("chat.newConversation");
  }

  #updateBusy(): void {
    this.#send.loading = this.#busy.has(store.activeId);
  }

  #renderMessages(): void {
    this.#messages.replaceChildren(...store.active.messages.map((m) => this.#element(m)));
    this.classList.toggle("is-empty", store.active.messages.length === 0);
    this.#scroller.scrollTop = this.#scroller.scrollHeight;
  }

  #element(m: Message): ChatMessage {
    const el = document.createElement("chat-message") as ChatMessage;
    el.setAttribute("role", m.role);
    if (m.variant) el.setAttribute("variant", m.variant);
    el.append(messageText(m));
    if (m.sessionUrl) {
      const meta = document.createElement("small");
      const a = document.createElement("a");
      a.href = m.sessionUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = t("msg.viewSession");
      meta.append(a, m.sessionId ? ` · ${m.sessionId}` : "");
      el.append(meta);
    }
    return el;
  }

  async #submit(): Promise<void> {
    const convo = store.active;
    const text = this.#input.value.trim();
    if (!text || this.#busy.has(convo.id)) return;
    this.#input.value = "";
    store.addMessage(convo.id, { role: "user", text });
    const pending = store.addMessage(convo.id, { role: "bot", text: "", key: "msg.running", variant: "pending" });
    this.#busy.add(convo.id);
    this.#updateBusy();
    let result: Partial<Message>;
    try {
      const r = await fetch("/api/fire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, triggerId: convo.triggerId, token: convo.token }),
      });
      result = this.#toMessage((await r.json()) as FireResponse);
    } catch (err) {
      result = { text: t("msg.networkError", { msg: (err as Error).message }), variant: "error" };
    }
    this.#busy.delete(convo.id);
    store.updateMessage(convo.id, pending.id, result);
    this.#updateBusy();
    if (store.activeId === convo.id) this.#input.focus();
  }

  #toMessage(res: FireResponse): Partial<Message> {
    if (res.code) return { variant: "error", text: t(`server.${res.code}` as Key, { msg: res.error ?? "" }) };
    if (res.error || !res.ok) {
      return {
        variant: "error",
        text: res.error ?? `Error ${res.status}: ${res.data?.error?.message ?? JSON.stringify(res.data)}`,
      };
    }
    const { claude_code_session_url: url, claude_code_session_id: id } = res.data ?? {};
    return url
      ? { text: "", key: "msg.fired", sessionUrl: url, sessionId: id }
      : { text: `${t("msg.fired")} ${JSON.stringify(res.data)}` };
  }
}

customElements.define("routine-chat", RoutineChat);
