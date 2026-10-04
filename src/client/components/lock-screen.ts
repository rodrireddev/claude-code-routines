import { t, type Key } from "../core/i18n.js";
import { store } from "../core/store.js";
import type { SlButton, SlInput } from "../core/types.js";

/** <lock-screen> — pide la contraseña para descifrar los datos locales. Emite "unlocked". */
export class LockScreen extends HTMLElement {
  #pass!: SlInput;
  #btn!: SlButton;
  #err!: HTMLElement;

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host { display:grid; place-items:center; height:100%; padding:var(--sl-spacing-large); }
        .card { width:min(380px,100%); display:grid; gap:var(--sl-spacing-medium); text-align:center; }
        .logo { justify-self:center; border-radius:50%; }
        h2 { margin:0; font-weight:var(--sl-font-weight-semibold); }
        p { margin:0; color:var(--sl-color-neutral-500); }
        .err { color:var(--sl-color-danger-600); font-size:var(--sl-font-size-small); min-height:1.2em; }
        .link::part(base) { font-size:var(--sl-font-size-small); color:var(--sl-color-neutral-500); }
      </style>
      <div class="card">
        <img class="logo" src="/assets/logo-128.png" alt="" width="72" height="72" />
        <h2>${t("lock.title")}</h2>
        <p>${t("lock.text")}</p>
        <sl-input type="password" placeholder="${t("lock.placeholder")}" password-toggle autocomplete="current-password"></sl-input>
        <div class="err"></div>
        <sl-button variant="primary" size="large">${t("lock.unlock")}</sl-button>
        <sl-button class="link" variant="text" size="small">${t("lock.forgot")}</sl-button>
      </div>`;
    const root = this.shadowRoot!;
    this.#pass = root.querySelector("sl-input") as SlInput;
    this.#btn = root.querySelector("sl-button[variant=primary]") as SlButton;
    this.#err = root.querySelector(".err") as HTMLElement;
  }

  connectedCallback(): void {
    this.#btn.addEventListener("click", () => void this.#unlock());
    this.#pass.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") void this.#unlock();
    });
    this.shadowRoot!.querySelector(".link")!.addEventListener("click", () => {
      if (confirm(t("lock.confirmReset"))) store.reset();
    });
    void this.#focus();
  }

  /** Espera a que Shoelace termine de renderizar el campo antes de enfocarlo. */
  async #focus(): Promise<void> {
    await customElements.whenDefined("sl-input");
    await (this.#pass as SlInput & { updateComplete?: Promise<unknown> }).updateComplete;
    this.#pass.focus();
  }

  async #unlock(): Promise<void> {
    if (!this.#pass.value || this.#btn.loading) return;
    this.#btn.loading = true;
    this.#err.textContent = "";
    try {
      await store.unlock(this.#pass.value);
      this.dispatchEvent(new Event("unlocked"));
    } catch (err) {
      this.#err.textContent = t((err as Error).message as Key);
      this.#pass.value = "";
      void this.#focus();
    } finally {
      this.#btn.loading = false;
    }
  }
}

customElements.define("lock-screen", LockScreen);
