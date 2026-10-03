import { store } from "./store.js";
import type { SlDrawer, SlInput } from "./types.js";

/** <chat-settings> — panel lateral con nombre, Trigger ID y Token de la conversación activa. */
export class ChatSettings extends HTMLElement {
  #title!: SlInput;
  #triggerId!: SlInput;
  #token!: SlInput;
  #drawer!: SlDrawer;

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        .fields { display:grid; gap:var(--sl-spacing-medium); }
        small { color:var(--sl-color-neutral-500); }
      </style>
      <sl-drawer label="Configuración de la conversación" placement="end">
        <div class="fields">
          <sl-input id="title" label="Nombre" placeholder="Sin título" autocomplete="off"></sl-input>
          <sl-input id="triggerId" label="Trigger ID" placeholder="trig_..." autocomplete="off" clearable></sl-input>
          <sl-input id="token" label="Token" type="password" placeholder="sk-ant-oat01-..." autocomplete="off" password-toggle></sl-input>
          <small>Cada conversación tiene su propio Trigger ID y Token. Se guardan solo en este equipo.</small>
        </div>
        <sl-button slot="footer" variant="primary">Listo</sl-button>
      </sl-drawer>`;
    const root = this.shadowRoot!;
    this.#title = root.getElementById("title") as SlInput;
    this.#triggerId = root.getElementById("triggerId") as SlInput;
    this.#token = root.getElementById("token") as SlInput;
    this.#drawer = root.querySelector("sl-drawer") as SlDrawer;
  }

  connectedCallback(): void {
    const root = this.shadowRoot!;
    this.#title.addEventListener("input", () => store.updateMeta(store.activeId, { title: this.#title.value }));
    this.#triggerId.addEventListener("input", () => store.updateMeta(store.activeId, { triggerId: this.#triggerId.value.trim() }));
    this.#token.addEventListener("input", () => store.updateMeta(store.activeId, { token: this.#token.value.trim() }));
    root.querySelector("sl-button")!.addEventListener("click", () => this.#drawer.hide());
    store.addEventListener("change", (e) => {
      const kind = (e as CustomEvent).detail;
      if (kind === "active" || kind === "list") this.#sync();
    });
    this.#sync();
    void customElements.whenDefined("sl-drawer").then(() => this.#autoOpen());
  }

  show(): void { this.#drawer.show(); }

  /** Abre el panel automáticamente al arrancar si falta configuración. */
  #autoOpen(): void {
    const c = store.active;
    if (!c.triggerId || !c.token) this.show();
  }

  /** Vuelca la conversación activa en los campos. */
  #sync(): void {
    const c = store.active;
    this.#title.value = c.title;
    this.#triggerId.value = c.triggerId;
    this.#token.value = c.token;
  }
}

customElements.define("chat-settings", ChatSettings);
