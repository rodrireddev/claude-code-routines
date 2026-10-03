/** Subconjunto de la API de los elementos de Shoelace que usamos. */
interface SlInputLike extends HTMLElement { value: string }
interface SlDetailsLike extends HTMLElement { open: boolean }

const KEYS = { triggerId: "triggerId", token: "token" } as const;

function load(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function save(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ }
}

/** <chat-settings> — campos de Trigger ID y Token, persistidos en localStorage. */
export class ChatSettings extends HTMLElement {
  #triggerId!: SlInputLike;
  #token!: SlInputLike;
  #details!: SlDetailsLike;

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        sl-details { --sl-panel-background-color:var(--sl-color-neutral-0); }
        sl-details::part(base) { border-radius:0; border-width:0 0 1px 0; }
        .fields { display:grid; gap:var(--sl-spacing-small); }
        small { color:var(--sl-color-neutral-500); }
      </style>
      <sl-details summary="⚙ Configuración">
        <div class="fields">
          <sl-input id="triggerId" label="Trigger ID" placeholder="trig_..." autocomplete="off" clearable></sl-input>
          <sl-input id="token" label="Token" type="password" placeholder="sk-ant-oat01-..." autocomplete="off" password-toggle></sl-input>
          <small>Se guarda solo en este equipo (localStorage).</small>
        </div>
      </sl-details>`;
    const root = this.shadowRoot!;
    this.#triggerId = root.getElementById("triggerId") as SlInputLike;
    this.#token = root.getElementById("token") as SlInputLike;
    this.#details = root.querySelector("sl-details")!;
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
