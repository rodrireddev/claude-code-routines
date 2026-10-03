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
        h3 { margin:0; font-size:var(--sl-font-size-medium); }
        .row { display:flex; gap:var(--sl-spacing-small); flex-wrap:wrap; }
        .err { color:var(--sl-color-danger-600); font-size:var(--sl-font-size-small); min-height:1em; }
      </style>
      <sl-drawer label="Configuración de la conversación" placement="end">
        <div class="fields">
          <sl-input id="title" label="Nombre" placeholder="Sin título" autocomplete="off"></sl-input>
          <sl-input id="triggerId" label="Trigger ID" placeholder="trig_..." autocomplete="off" clearable></sl-input>
          <sl-input id="token" label="Token" type="password" placeholder="sk-ant-oat01-..." autocomplete="off" password-toggle></sl-input>
          <small>Cada conversación tiene su propio Trigger ID y Token. Se guardan solo en este equipo.</small>
        </div>
        <sl-divider></sl-divider>
        <div class="fields" id="security"></div>
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
    store.addEventListener("security", () => this.#renderSecurity());
    this.#renderSecurity();
    store.addEventListener("change", (e) => {
      const kind = (e as CustomEvent).detail;
      if (kind === "active" || kind === "list") this.#sync();
    });
    this.#sync();
    void customElements.whenDefined("sl-drawer").then(() => this.#autoOpen());
  }

  /** Sección "Seguridad": activar/quitar cifrado o bloquear. */
  #renderSecurity(): void {
    const box = this.shadowRoot!.getElementById("security")!;
    if (store.encrypted) {
      box.innerHTML = `
        <h3>🔒 Seguridad</h3>
        <small>Los datos locales están cifrados (AES-256-GCM). Se pedirá la contraseña al abrir la app.</small>
        <div class="row"><sl-button id="lock">Bloquear ahora</sl-button><sl-button id="off" variant="danger" outline>Quitar cifrado</sl-button></div>`;
      box.querySelector("#lock")!.addEventListener("click", () => void store.lock());
      box.querySelector("#off")!.addEventListener("click", () => {
        if (confirm("¿Quitar el cifrado? Los datos volverán a guardarse en claro.")) void store.disableEncryption();
      });
      return;
    }
    box.innerHTML = `
      <h3>Seguridad</h3>
      <small>Ahora mismo las conversaciones y los tokens se guardan <b>en claro</b> en este equipo. Protégelos con una contraseña.</small>
      <sl-input id="p1" type="password" label="Contraseña (mín. 8 caracteres)" password-toggle autocomplete="new-password"></sl-input>
      <sl-input id="p2" type="password" label="Repite la contraseña" password-toggle autocomplete="new-password"></sl-input>
      <div class="err" id="err"></div>
      <sl-button id="on" variant="primary">Cifrar datos</sl-button>
      <small>Si la olvidas no hay forma de recuperar los datos cifrados.</small>`;
    const p1 = box.querySelector("#p1") as SlInput;
    const p2 = box.querySelector("#p2") as SlInput;
    const err = box.querySelector("#err") as HTMLElement;
    const btn = box.querySelector("#on") as HTMLElement & { loading: boolean };
    btn.addEventListener("click", async () => {
      if (p1.value.length < 8) return void (err.textContent = "La contraseña debe tener al menos 8 caracteres.");
      if (p1.value !== p2.value) return void (err.textContent = "Las contraseñas no coinciden.");
      btn.loading = true;
      await store.enableEncryption(p1.value);
    });
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
