import { ApiError, login } from "../core/api.js";
import { t } from "../core/i18n.js";
import type { SlButton, SlInput } from "../core/types.js";

/** <login-screen> — shown when the server requires the admin password. Emits "logged-in". */
export class LoginScreen extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host { display:grid; place-items:center; height:100%; padding:var(--sl-spacing-large); }
        form { width:min(360px,100%); display:grid; gap:var(--sl-spacing-medium); text-align:center; }
        img { justify-self:center; border-radius:50%; }
        h2 { margin:0; font-weight:var(--sl-font-weight-semibold); }
        p { margin:0; color:var(--sl-color-neutral-500); }
        .err { color:var(--sl-color-danger-600); font-size:var(--sl-font-size-small); min-height:1.2em; }
      </style>
      <form>
        <img src="/assets/logo-128.png" alt="" width="72" height="72" />
        <h2>${t("login.title")}</h2>
        <p>${t("login.text")}</p>
        <sl-input type="password" placeholder="${t("login.placeholder")}" password-toggle autocomplete="current-password" required></sl-input>
        <div class="err"></div>
        <sl-button type="submit" variant="primary" size="large">${t("login.submit")}</sl-button>
      </form>`;
  }

  connectedCallback(): void {
    const root = this.shadowRoot!;
    const input = root.querySelector("sl-input") as SlInput;
    const button = root.querySelector("sl-button") as SlButton;
    const err = root.querySelector(".err") as HTMLElement;
    const submit = async (): Promise<void> => {
      if (!input.value || button.loading) return;
      button.loading = true;
      err.textContent = "";
      try {
        await login(input.value);
        this.dispatchEvent(new Event("logged-in"));
      } catch (e) {
        err.textContent = e instanceof ApiError && e.code === "wrong_password" ? t("login.wrong") : (e as Error).message;
        input.value = "";
      } finally {
        button.loading = false;
      }
    };
    root.querySelector("form")!.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
    input.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void submit(); });
    button.addEventListener("click", () => void submit());
  }
}

customElements.define("login-screen", LoginScreen);
