import { getLang, LANGUAGES, setLang, t, type Lang } from "./i18n.js";
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
      <sl-drawer label="${t("set.title")}" placement="end">
        <div class="fields">
          <sl-input id="title" label="${t("set.name")}" placeholder="${t("side.untitled")}" autocomplete="off"></sl-input>
          <sl-input id="triggerId" label="Trigger ID" placeholder="trig_..." autocomplete="off" clearable></sl-input>
          <sl-input id="token" label="Token" type="password" placeholder="sk-ant-oat01-..." autocomplete="off" password-toggle></sl-input>
          <small>${t("set.note")}</small>
        </div>
        <sl-divider></sl-divider>
        <div class="fields" id="security"></div>
        <sl-divider></sl-divider>
        <div class="fields">
          <h3>${t("set.app")}</h3>
          <sl-select id="lang" label="${t("set.language")}" value="${getLang()}" hoist>
            ${LANGUAGES.map((l) => `<sl-option value="${l.code}">${l.name}</sl-option>`).join("")}
          </sl-select>
        </div>
        <sl-button slot="footer" variant="primary">${t("set.done")}</sl-button>
      </sl-drawer>`;
    const root = this.shadowRoot!;
    this.#title = root.getElementById("title") as SlInput;
    this.#triggerId = root.getElementById("triggerId") as SlInput;
    this.#token = root.getElementById("token") as SlInput;
    this.#drawer = root.querySelector("sl-drawer") as SlDrawer;
  }

  /** Detaches store/window listeners when the element is discarded (e.g. UI rebuilt after a language change). */
  #off = new AbortController();

  disconnectedCallback(): void {
    this.#off.abort();
  }

  connectedCallback(): void {
    this.#off = new AbortController();
    const root = this.shadowRoot!;
    this.#title.addEventListener("input", () => store.updateMeta(store.activeId, { title: this.#title.value }));
    this.#triggerId.addEventListener("input", () => store.updateMeta(store.activeId, { triggerId: this.#triggerId.value.trim() }));
    this.#token.addEventListener("input", () => store.updateMeta(store.activeId, { token: this.#token.value.trim() }));
    root.querySelector("sl-button[slot=footer]")!.addEventListener("click", () => this.#drawer.hide());
    root.getElementById("lang")!.addEventListener("sl-change", (e) =>
      setLang((e.target as HTMLElement & { value: string }).value as Lang));
    store.addEventListener("security", () => this.#renderSecurity(), { signal: this.#off.signal });
    this.#renderSecurity();
    store.addEventListener("change", (e) => {
      const kind = (e as CustomEvent).detail;
      if (kind === "active" || kind === "list") this.#sync();
    }, { signal: this.#off.signal });
    this.#sync();
    void customElements.whenDefined("sl-drawer").then(() => this.#autoOpen());
  }

  /** Sección "Seguridad": activar/quitar cifrado o bloquear. */
  #renderSecurity(): void {
    const box = this.shadowRoot!.getElementById("security")!;
    if (store.encrypted) {
      box.innerHTML = `
        <h3>🔒 ${t("sec.title")}</h3>
        <small>${t("sec.encrypted")}</small>
        <div class="row"><sl-button id="lock">${t("sec.lockNow")}</sl-button><sl-button id="off" variant="danger" outline>${t("sec.disable")}</sl-button></div>`;
      box.querySelector("#lock")!.addEventListener("click", () => void store.lock());
      box.querySelector("#off")!.addEventListener("click", () => {
        if (confirm(t("sec.confirmDisable"))) void store.disableEncryption();
      });
      return;
    }
    box.innerHTML = `
      <h3>${t("sec.title")}</h3>
      <small>${t("sec.plain")}</small>
      <sl-input id="p1" type="password" label="${t("sec.pass")}" password-toggle autocomplete="new-password"></sl-input>
      <sl-input id="p2" type="password" label="${t("sec.pass2")}" password-toggle autocomplete="new-password"></sl-input>
      <div class="err" id="err"></div>
      <sl-button id="on" variant="primary">${t("sec.encrypt")}</sl-button>
      <small>${t("sec.noRecovery")}</small>`;
    const p1 = box.querySelector("#p1") as SlInput;
    const p2 = box.querySelector("#p2") as SlInput;
    const err = box.querySelector("#err") as HTMLElement;
    const btn = box.querySelector("#on") as HTMLElement & { loading: boolean };
    btn.addEventListener("click", async () => {
      if (p1.value.length < 8) return void (err.textContent = t("sec.tooShort"));
      if (p1.value !== p2.value) return void (err.textContent = t("sec.mismatch"));
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
