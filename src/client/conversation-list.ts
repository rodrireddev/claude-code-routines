import { store } from "./store.js";
import { cycleTheme, getTheme, type ThemeMode } from "./theme.js";
import { getLang, LANGUAGES, setLang, t, type Lang } from "./i18n.js";

/** <conversation-list> — barra lateral con las conversaciones guardadas. */
export class ConversationList extends HTMLElement {
  #list!: HTMLElement;

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host { display:flex; flex-direction:column; height:100%; background:var(--sl-color-neutral-100); }
        .brand { padding:var(--sl-spacing-medium) var(--sl-spacing-medium) var(--sl-spacing-x-small); font-weight:var(--sl-font-weight-semibold); display:flex; align-items:center; gap:var(--sl-spacing-x-small); }
        .brand img { border-radius:50%; }
        .top { padding:var(--sl-spacing-x-small) var(--sl-spacing-small) var(--sl-spacing-small); }
        .top sl-button { width:100%; }
        .top sl-button::part(base) { justify-content:flex-start; background:transparent; border-color:var(--sl-color-neutral-300); }
        .foot { padding:var(--sl-spacing-x-small) var(--sl-spacing-small); border-top:1px solid var(--sl-color-neutral-200); }
        .foot { display:flex; align-items:center; gap:var(--sl-spacing-2x-small); }
        .foot .prs { flex:1; }
        .lang sl-icon-button { font-size:var(--sl-font-size-large); color:var(--sl-color-neutral-600); }
        .theme { font-size:var(--sl-font-size-large); color:var(--sl-color-neutral-600); }
        .foot sl-button::part(base) { justify-content:flex-start; }
        :host([prs]) .foot sl-button::part(base) { background:var(--sl-color-neutral-200); }
        :host([prs]) .item.active { background:transparent; font-weight:var(--sl-font-weight-normal); }
        .label { padding:var(--sl-spacing-x-small) var(--sl-spacing-medium); font-size:var(--sl-font-size-x-small); color:var(--sl-color-neutral-500); }
        nav { flex:1; overflow-y:auto; padding:0 var(--sl-spacing-x-small) var(--sl-spacing-small); display:flex; flex-direction:column; gap:2px; }
        .item { display:flex; align-items:center; gap:var(--sl-spacing-2x-small); padding:var(--sl-spacing-x-small) var(--sl-spacing-small); border-radius:var(--sl-border-radius-large); cursor:pointer; }
        .item:hover { background:var(--sl-color-neutral-200); }
        .item.active { background:var(--sl-color-neutral-200); font-weight:var(--sl-font-weight-semibold); }
        .name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .name small { display:block; font-weight:var(--sl-font-weight-normal); color:var(--sl-color-neutral-500); font-size:var(--sl-font-size-x-small); }
        .item sl-icon-button { font-size:var(--sl-font-size-medium); opacity:0; }
        .item:hover sl-icon-button, .item.active sl-icon-button { opacity:1; }
      </style>
      <div class="brand"><img src="/assets/logo-128.png" alt="" width="28" height="28" /> Routine Chat</div>
      <div class="top"><sl-button><sl-icon slot="prefix" name="plus-lg"></sl-icon>${t("side.new")}</sl-button></div>
      <div class="label">${t("side.conversations")}</div>
      <nav></nav>
      <div class="foot"><sl-button class="prs" variant="text"><sl-icon slot="prefix" name="github"></sl-icon>Pull requests</sl-button><sl-dropdown class="lang" placement="top-end" hoist>
          <sl-icon-button slot="trigger" name="translate" label="${t("side.language")}"></sl-icon-button>
          <sl-menu>${LANGUAGES.map((l) => `<sl-menu-item type="checkbox" value="${l.code}"${l.code === getLang() ? " checked" : ""}>${l.name}</sl-menu-item>`).join("")}</sl-menu>
        </sl-dropdown><sl-icon-button class="theme" name="circle-half"></sl-icon-button></div>`;
    this.#list = this.shadowRoot!.querySelector("nav")!;
  }

  /** Detaches store/window listeners when the element is discarded (e.g. UI rebuilt after a language change). */
  #off = new AbortController();

  disconnectedCallback(): void {
    this.#off.abort();
  }

  connectedCallback(): void {
    this.#off = new AbortController();
    this.shadowRoot!.querySelector("sl-button")!.addEventListener("click", () => {
      store.create();
      this.#openChat();
      this.dispatchEvent(new Event("new-conversation", { bubbles: true, composed: true }));
    });
    this.shadowRoot!.querySelector("sl-menu")!.addEventListener("sl-select", (e) =>
      setLang((e as CustomEvent<{ item: { value: string } }>).detail.item.value as Lang));
    this.shadowRoot!.querySelector(".prs")!.addEventListener("click", () =>
      this.dispatchEvent(new Event("open-prs", { bubbles: true, composed: true })));
    const theme = this.shadowRoot!.querySelector(".theme")!;
    const syncTheme = (): void => {
      const mode: ThemeMode = getTheme();
      theme.setAttribute("name", { system: "circle-half", light: "sun", dark: "moon" }[mode]);
      theme.setAttribute("label", t(({ system: "side.themeSystem", light: "side.themeLight", dark: "side.themeDark" } as const)[mode]));
    };
    theme.addEventListener("click", () => void cycleTheme());
    window.addEventListener("themechange", syncTheme, { signal: this.#off.signal });
    syncTheme();
    store.addEventListener("change", () => this.#render(), { signal: this.#off.signal });
    this.#render();
  }

  /** Pide volver a la vista de chat (p. ej. desde Pull requests), aunque la conversación ya estuviera activa. */
  #openChat(): void {
    this.dispatchEvent(new Event("open-chat", { bubbles: true, composed: true }));
  }

  #render(): void {
    const items = store.conversations
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => {
        const item = document.createElement("div");
        item.className = "item" + (c.id === store.activeId ? " active" : "");
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = c.title || t("side.untitled");
        const sub = document.createElement("small");
        sub.textContent = c.triggerId || t("side.noTrigger");
        name.append(sub);
        const del = document.createElement("sl-icon-button");
        del.setAttribute("name", "trash");
        del.setAttribute("label", t("side.delete"));
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          if (confirm(t("side.confirmDelete", { name: c.title || t("side.untitled") }))) store.remove(c.id);
        });
        item.append(name, del);
        item.addEventListener("click", () => {
          store.select(c.id);
          this.#openChat();
        });
        return item;
      });
    this.#list.replaceChildren(...items);
  }
}

customElements.define("conversation-list", ConversationList);
