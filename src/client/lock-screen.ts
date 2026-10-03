import { store } from "./store.js";
import type { SlButton, SlInput } from "./types.js";

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
        .logo { font-size:40px; color:var(--sl-color-primary-600); }
        h2 { margin:0; font-weight:var(--sl-font-weight-semibold); }
        p { margin:0; color:var(--sl-color-neutral-500); }
        .err { color:var(--sl-color-danger-600); font-size:var(--sl-font-size-small); min-height:1.2em; }
        .link::part(base) { font-size:var(--sl-font-size-small); color:var(--sl-color-neutral-500); }
      </style>
      <div class="card">
        <div class="logo">🔒</div>
        <h2>Datos cifrados</h2>
        <p>Introduce tu contraseña para abrir tus conversaciones.</p>
        <sl-input type="password" placeholder="Contraseña" password-toggle autocomplete="current-password"></sl-input>
        <div class="err"></div>
        <sl-button variant="primary" size="large">Desbloquear</sl-button>
        <sl-button class="link" variant="text" size="small">Olvidé mi contraseña (borrar todo)</sl-button>
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
      if (confirm("Se borrarán TODAS las conversaciones y tokens guardados. ¿Continuar?")) store.reset();
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
      this.#err.textContent = (err as Error).message;
      this.#pass.value = "";
      void this.#focus();
    } finally {
      this.#btn.loading = false;
    }
  }
}

customElements.define("lock-screen", LockScreen);
