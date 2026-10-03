const KEYS = { triggerId: "triggerId", token: "token" } as const;

function load(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function save(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ }
}

/** <chat-settings> — campos de Trigger ID y Token, persistidos en localStorage. */
export class ChatSettings extends HTMLElement {
  #triggerId!: HTMLInputElement;
  #token!: HTMLInputElement;
  #details!: HTMLDetailsElement;

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        details { background:var(--panel); border-bottom:1px solid var(--bot); padding:8px 16px; }
        summary { cursor:pointer; color:var(--muted); }
        .fields { display:grid; gap:8px; padding-top:8px; }
        label { display:grid; gap:2px; font-size:13px; color:var(--muted); }
        input { padding:8px 10px; border-radius:8px; border:1px solid var(--bot); background:var(--bg); color:var(--text); font:inherit; }
        small { color:var(--muted); }
      </style>
      <details>
        <summary>⚙ Configuración</summary>
        <div class="fields">
          <label>Trigger ID <input id="triggerId" placeholder="trig_..." autocomplete="off" /></label>
          <label>Token <input id="token" type="password" placeholder="sk-ant-oat01-..." autocomplete="off" /></label>
          <small>Se guarda solo en este navegador (localStorage).</small>
        </div>
      </details>`;
    const root = this.shadowRoot!;
    this.#triggerId = root.getElementById("triggerId") as HTMLInputElement;
    this.#token = root.getElementById("token") as HTMLInputElement;
    this.#details = root.querySelector("details")!;
  }

  connectedCallback(): void {
    this.#triggerId.value = load(KEYS.triggerId);
    this.#token.value = load(KEYS.token);
    this.#triggerId.addEventListener("input", () => save(KEYS.triggerId, this.#triggerId.value));
    this.#token.addEventListener("input", () => save(KEYS.token, this.#token.value));
    if (!this.triggerId || !this.token) this.#details.open = true;
  }

  get triggerId(): string { return this.#triggerId.value.trim(); }
  get token(): string { return this.#token.value.trim(); }
  open(): void { this.#details.open = true; }
}

customElements.define("chat-settings", ChatSettings);
