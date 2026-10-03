import "./chat-message.js";
import "./chat-settings.js";
import type { ChatMessage, Role, Variant } from "./chat-message.js";
import type { ChatSettings } from "./chat-settings.js";
import type { FireResponse } from "./types.js";

/** <routine-chat> — chat completo que dispara la routine vía /api/fire. */
export class RoutineChat extends HTMLElement {
  #settings!: ChatSettings;
  #messages!: HTMLDivElement;
  #form!: HTMLFormElement;
  #input!: HTMLTextAreaElement;
  #send!: HTMLButtonElement;

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host { display:flex; flex-direction:column; height:100%; }
        header { padding:14px 16px; background:var(--panel); border-bottom:1px solid var(--bot); font-weight:600; }
        #messages { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px; }
        form { display:flex; gap:8px; padding:12px 16px; background:var(--panel); border-top:1px solid var(--bot); }
        textarea { flex:1; resize:none; padding:10px 12px; border-radius:10px; border:1px solid var(--bot); background:var(--bg); color:var(--text); font:inherit; }
        button { padding:0 18px; border:0; border-radius:10px; background:var(--user); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
        button:disabled { opacity:.5; cursor:default; }
      </style>
      <header>Routine Chat</header>
      <chat-settings></chat-settings>
      <div id="messages"></div>
      <form>
        <textarea rows="2" placeholder="Escribe el texto para la routine… (Enter envía, Shift+Enter nueva línea)" required></textarea>
        <button type="submit">Enviar</button>
      </form>`;
    const root = this.shadowRoot!;
    this.#settings = root.querySelector("chat-settings") as ChatSettings;
    this.#messages = root.getElementById("messages") as HTMLDivElement;
    this.#form = root.querySelector("form")!;
    this.#input = root.querySelector("textarea")!;
    this.#send = root.querySelector("button")!;
  }

  connectedCallback(): void {
    this.#form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.#submit();
    });
    this.#input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.#form.requestSubmit();
      }
    });
  }

  #add(role: Role, content: string | Node[], variant: Variant = ""): ChatMessage {
    const el = document.createElement("chat-message") as ChatMessage;
    el.setAttribute("role", role);
    if (variant) el.setAttribute("variant", variant);
    el.replaceChildren(...(typeof content === "string" ? [content] : content));
    this.#messages.appendChild(el);
    this.#scroll();
    return el;
  }

  #scroll(): void {
    this.#messages.scrollTop = this.#messages.scrollHeight;
  }

  async #submit(): Promise<void> {
    const text = this.#input.value.trim();
    if (!text) return;
    this.#input.value = "";
    this.#add("user", text);
    const pending = this.#add("bot", "Ejecutando routine…", "pending");
    this.#send.disabled = true;
    try {
      const r = await fetch("/api/fire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, triggerId: this.#settings.triggerId, token: this.#settings.token }),
      });
      this.#render(pending, (await r.json()) as FireResponse);
    } catch (err) {
      this.#render(pending, { error: `Error de red: ${(err as Error).message}` });
    } finally {
      this.#send.disabled = false;
      this.#input.focus();
      this.#scroll();
    }
  }

  #render(el: ChatMessage, res: FireResponse): void {
    el.removeAttribute("variant");
    if (res.error || !res.ok) {
      el.setAttribute("variant", "error");
      el.replaceChildren(
        res.error ?? `Error ${res.status}: ${res.data?.error?.message ?? JSON.stringify(res.data)}`,
      );
      return;
    }
    const { claude_code_session_url: url, claude_code_session_id: id } = res.data ?? {};
    const meta = document.createElement("small");
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Ver sesión y respuesta";
      meta.append(a, id ? ` · ${id}` : "");
    } else {
      meta.textContent = JSON.stringify(res.data);
    }
    el.replaceChildren("Routine lanzada correctamente.", meta);
  }
}

customElements.define("routine-chat", RoutineChat);
