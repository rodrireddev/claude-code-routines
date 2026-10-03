import "./chat-message.js";
import "./chat-settings.js";
import type { ChatMessage, Role, Variant } from "./chat-message.js";
import type { ChatSettings } from "./chat-settings.js";
import type { FireResponse } from "./types.js";

/** Subconjunto de la API de los elementos de Shoelace que usamos. */
interface SlTextarea extends HTMLElement { value: string }
interface SlButton extends HTMLElement { disabled: boolean; loading: boolean }

/** <routine-chat> — chat completo que dispara la routine vía /api/fire. */
export class RoutineChat extends HTMLElement {
  #settings!: ChatSettings;
  #messages!: HTMLDivElement;
  #form!: HTMLFormElement;
  #input!: SlTextarea;
  #send!: SlButton;

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host { display:flex; flex-direction:column; height:100%; }
        header { padding:var(--sl-spacing-medium); background:var(--sl-color-neutral-0); border-bottom:1px solid var(--sl-color-neutral-200); font-weight:var(--sl-font-weight-semibold); font-size:var(--sl-font-size-large); }
        #messages { flex:1; overflow-y:auto; padding:var(--sl-spacing-medium); display:flex; flex-direction:column; gap:var(--sl-spacing-small); }
        form { display:flex; gap:var(--sl-spacing-small); align-items:flex-end; padding:var(--sl-spacing-small) var(--sl-spacing-medium); background:var(--sl-color-neutral-0); border-top:1px solid var(--sl-color-neutral-200); }
        sl-textarea { flex:1; }
      </style>
      <header>Routine Chat</header>
      <chat-settings></chat-settings>
      <div id="messages"></div>
      <form>
        <sl-textarea rows="2" resize="none" placeholder="Escribe el texto para la routine… (Enter envía, Shift+Enter nueva línea)"></sl-textarea>
        <sl-button type="button" variant="primary" size="large">Enviar</sl-button>
      </form>`;
    const root = this.shadowRoot!;
    this.#settings = root.querySelector("chat-settings") as ChatSettings;
    this.#messages = root.getElementById("messages") as HTMLDivElement;
    this.#form = root.querySelector("form")!;
    this.#input = root.querySelector("sl-textarea") as SlTextarea;
    this.#send = root.querySelector("sl-button") as SlButton;
  }

  connectedCallback(): void {
    this.#form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.#submit();
    });
    this.#send.addEventListener("click", () => void this.#submit());
    this.#input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.#submit();
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
    if (!text || this.#send.loading) return;
    this.#input.value = "";
    this.#add("user", text);
    const pending = this.#add("bot", "Ejecutando routine…", "pending");
    this.#send.loading = true;
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
      this.#send.loading = false;
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
