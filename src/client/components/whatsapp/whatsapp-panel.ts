import { COMMAND_ACTIONS, normalizeTrigger, type CommandAction, type PublicCommand } from "../../../shared/commands.js";
import { api } from "../../core/api.js";
import { githubAuth } from "../../core/github-auth.js";
import { h } from "../../core/dom.js";
import { t, type Key } from "../../core/i18n.js";
import { store } from "../../core/store.js";
import type { SlButton, SlInput } from "../../core/types.js";

interface WhatsAppState { status: "disabled" | "disconnected" | "connecting" | "qr" | "connected"; qr?: string; account?: string; error?: string }
interface BotSettings { commands: PublicCommand[] }
interface ActivityEntry { at: string; kind: "info" | "seen" | "received" | "ignored" | "sent" | "error"; text: string }

/** Command being edited. `token` is only sent when the user typed a new one. */
interface DraftCommand extends Omit<PublicCommand, "routine"> {
  routine?: { triggerId: string; hasToken: boolean; token: string };
}

type Field = HTMLElement & { value: string; checked: boolean };

/**
 * <whatsapp-panel> — links WhatsApp (QR), configures the bot's GitHub token and edits the chat commands.
 * All of this lives on the server, which runs the bot even when no browser is open.
 */
export class WhatsAppPanel extends HTMLElement {
  #root: ShadowRoot;
  #state: WhatsAppState = { status: "disconnected" };
  #commands: DraftCommand[] = [];
  #timer: number | undefined;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    this.#root.innerHTML = `
      <style>
        :host { flex:1; min-height:0; overflow-y:auto; }
        .page { max-width:860px; margin:0 auto; padding:var(--sl-spacing-medium); display:grid; gap:var(--sl-spacing-large); }
        .intro, .muted { color:var(--sl-color-neutral-600); font-size:var(--sl-font-size-small); }
        section { border:1px solid var(--sl-color-neutral-200); border-radius:var(--sl-border-radius-large); padding:var(--sl-spacing-medium); display:grid; gap:var(--sl-spacing-small); }
        h3 { margin:0; font-size:var(--sl-font-size-large); display:flex; align-items:center; gap:var(--sl-spacing-x-small); }
        .row { display:flex; gap:var(--sl-spacing-small); align-items:center; flex-wrap:wrap; }
        .grow { flex:1; min-width:200px; }
        .qr { justify-self:center; background:#fff; padding:8px; border-radius:var(--sl-border-radius-medium); }
        .err { color:var(--sl-color-danger-600); font-size:var(--sl-font-size-small); white-space:pre-wrap; }
        .ok { color:var(--sl-color-success-700); font-size:var(--sl-font-size-small); }
        .cmd { border:1px solid var(--sl-color-neutral-200); border-radius:var(--sl-border-radius-medium); padding:var(--sl-spacing-small); display:grid; gap:var(--sl-spacing-x-small); }
        .cmd .head { display:grid; grid-template-columns:160px 1fr auto auto; gap:var(--sl-spacing-small); align-items:end; }
        .cmd .routine { display:grid; grid-template-columns:1fr 1fr auto; gap:var(--sl-spacing-small); align-items:end; }
        @media (max-width:700px) { .cmd .head, .cmd .routine { grid-template-columns:1fr; } }
        code { font-family:var(--sl-font-mono); }
        [hidden] { display:none !important; }
        .log { display:grid; gap:4px; max-height:280px; overflow:auto; font-size:var(--sl-font-size-small); }
        .act { display:grid; grid-template-columns:auto auto 1fr; gap:var(--sl-spacing-x-small); align-items:baseline; }
        .act .time { color:var(--sl-color-neutral-500); font-family:var(--sl-font-mono); font-size:var(--sl-font-size-x-small); }
        .act .text { word-break:break-word; font-family:var(--sl-font-mono); font-size:var(--sl-font-size-x-small); }
        sl-badge::part(base) { font-size:var(--sl-font-size-x-small); }
      </style>
      <div class="page">
        <div class="intro">${t("wa.intro")}</div>
        <section id="connection"></section>
        <section id="activity"></section>
        <section id="github"></section>
        <section id="commands"></section>
      </div>`;
  }

  connectedCallback(): void {
    this.#off = new AbortController();
    void this.#refreshStatus();
    void this.#loadSettings();
    githubAuth.addEventListener("change", () => this.#renderGithub(), { signal: this.#off.signal });
    // Poll the connection while the panel is visible: fast while a QR is on screen, slow otherwise.
    const tick = (): void => {
      const delay = this.#state.status === "disconnected" || this.#state.status === "disabled" ? 10000 : 2500;
      this.#timer = window.setTimeout(() => {
        if (this.offsetParent !== null) void this.#refreshStatus();
        tick();
      }, delay);
    };
    tick();
  }

  #off = new AbortController();

  disconnectedCallback(): void {
    this.#off.abort();
    window.clearTimeout(this.#timer);
  }

  // ---- Connection ----------------------------------------------------------------

  async #refreshStatus(): Promise<void> {
    try {
      this.#state = await api<WhatsAppState>("/api/whatsapp/status");
    } catch (e) {
      this.#state = { status: "disconnected", error: (e as Error).message };
    }
    this.#renderConnection();
    if (this.#state.status === "connected") {
      const { activity } = await api<{ activity: ActivityEntry[] }>("/api/whatsapp/activity").catch(() => ({ activity: [] }));
      this.#renderActivity(activity);
    } else {
      this.#root.getElementById("activity")!.replaceChildren();
      this.#root.getElementById("activity")!.hidden = true;
    }
  }

  /** Live log of what the app sees in the own chat, plus a test button: makes "no reply" diagnosable. */
  #renderActivity(activity: ActivityEntry[], error = ""): void {
    const box = this.#root.getElementById("activity")!;
    box.hidden = false;
    const test = h("sl-button", { size: "small" }, h("sl-icon", { slot: "prefix", name: "send" }), t("wa.sendTest")) as unknown as SlButton & HTMLElement;
    test.addEventListener("click", async () => {
      test.loading = true;
      try {
        const result = await api<{ activity: ActivityEntry[] }>("/api/whatsapp/test", { method: "POST", body: {} });
        this.#renderActivity(result.activity);
      } catch (e) {
        const { activity: latest } = await api<{ activity: ActivityEntry[] }>("/api/whatsapp/activity").catch(() => ({ activity }));
        this.#renderActivity(latest, (e as Error).message);
      }
    });
    const variant = { info: "neutral", seen: "neutral", received: "primary", ignored: "warning", sent: "success", error: "danger" } as const;
    const rows = activity.slice(0, 25).map((a) => h("div", { class: "act" },
      h("span", { class: "time" }, new Date(a.at).toLocaleTimeString()),
      h("sl-badge", { variant: variant[a.kind] }, a.kind),
      h("span", { class: "text" }, a.text)));
    box.replaceChildren(
      h("h3", {}, h("sl-icon", { name: "activity" }), t("wa.activity")),
      h("div", { class: "muted" }, t("wa.activityHelp")),
      h("div", { class: "row" }, test),
      error ? h("div", { class: "err" }, error) : h("span", {}),
      rows.length ? h("div", { class: "log" }, ...rows) : h("div", { class: "muted" }, t("wa.noActivity")),
    );
  }

  #renderConnection(): void {
    const s = this.#state;
    const box = this.#root.getElementById("connection")!;
    const badge = h("sl-badge", { variant: s.status === "connected" ? "success" : s.status === "qr" ? "warning" : "neutral", pill: "" },
      t(`wa.status.${s.status}` as Key, { account: s.account ?? "" }));
    const children: (Node | null)[] = [h("h3", {}, h("sl-icon", { name: "whatsapp" }), t("wa.connection"), badge)];

    if (s.status === "qr" && s.qr) {
      const img = h("img", { class: "qr", src: s.qr, alt: "QR", width: "240", height: "240" });
      children.push(h("div", { class: "muted" }, t("wa.qrHelp")), img);
    }
    if (s.status === "connected") children.push(h("div", { class: "muted" }, t("wa.howto")));
    if (s.error) children.push(h("div", { class: "err" }, s.error));

    const actions = h("div", { class: "row" });
    if (s.status === "disconnected") {
      const connect = h("sl-button", { variant: "primary" }, h("sl-icon", { slot: "prefix", name: "qr-code" }), t("wa.connect"));
      connect.addEventListener("click", () => void this.#action("/api/whatsapp/connect"));
      actions.append(connect);
    }
    if (s.status === "connected" || s.status === "qr" || s.status === "connecting") {
      const unlink = h("sl-button", { variant: "danger", outline: "" }, t("wa.disconnect"));
      unlink.addEventListener("click", () => {
        if (confirm(t("wa.confirmDisconnect"))) void this.#action("/api/whatsapp/logout");
      });
      actions.append(unlink);
    }
    children.push(actions, h("div", { class: "muted" }, t("wa.warning")));
    box.replaceChildren(...children.filter((c): c is Node => c !== null));
  }

  async #action(path: string): Promise<void> {
    try {
      this.#state = await api<WhatsAppState>(path, { method: "POST", body: {} });
    } catch (e) {
      this.#state = { ...this.#state, error: (e as Error).message };
    }
    this.#renderConnection();
  }

  // ---- Settings (GitHub token + commands) ------------------------------------------

  async #loadSettings(): Promise<void> {
    try {
      const settings = await api<BotSettings>("/api/bot/settings");
      this.#renderGithub();
      this.#setCommands(settings.commands);
    } catch (e) {
      this.#root.getElementById("commands")!.replaceChildren(h("div", { class: "err" }, (e as Error).message));
    }
  }

  /** The app's single GitHub token (shared with the Pull requests view). */
  #renderGithub(message = "", error = ""): void {
    const box = this.#root.getElementById("github")!;
    const input = h("sl-input", { type: "password", placeholder: t("wa.tokenPlaceholder"), "password-toggle": "", autocomplete: "off", class: "grow" }) as unknown as SlInput & HTMLElement;
    const save = h("sl-button", { variant: "primary" }, t("wa.save")) as unknown as SlButton & HTMLElement;
    const saveToken = async (token: string): Promise<void> => {
      save.loading = true;
      try {
        await githubAuth.save(token);
        this.#renderGithub(t("wa.saved"));
      } catch (e) {
        this.#renderGithub("", (e as Error).message);
      }
    };
    save.addEventListener("click", () => input.value.trim() && void saveToken(input.value));
    const row = h("div", { class: "row" }, input, save);
    const configured = !!githubAuth.token;
    if (configured) {
      const remove = h("sl-button", { variant: "text" }, t("wa.removeToken"));
      remove.addEventListener("click", () => void saveToken(""));
      row.append(remove);
    }
    box.replaceChildren(
      h("h3", {}, h("sl-icon", { name: "github" }), t("wa.github"),
        h("sl-badge", { variant: configured ? "success" : "neutral", pill: "" },
          configured ? t("wa.githubConnected", { login: githubAuth.login ?? "?" }) : t("wa.githubMissing"))),
      h("div", { class: "muted" }, t("wa.githubHelp")),
      row,
      message ? h("div", { class: "ok" }, message) : h("span", {}),
      error ? h("div", { class: "err" }, error) : h("span", {}),
    );
  }


  #setCommands(commands: PublicCommand[]): void {
    this.#commands = commands.map(({ routine, ...c }): DraftCommand =>
      (routine ? { ...c, routine: { ...routine, token: "" } } : c));
    this.#renderCommands();
  }

  #renderCommands(message = "", error = ""): void {
    const box = this.#root.getElementById("commands")!;
    const add = h("sl-button", {}, h("sl-icon", { slot: "prefix", name: "plus-lg" }), t("wa.addRoutine"));
    add.addEventListener("click", () => {
      this.#commands.push({
        id: "", trigger: `/routine${this.#commands.length + 1}`, action: "run_routine", description: "", enabled: true,
        routine: { triggerId: "", hasToken: false, token: "" },
      });
      this.#renderCommands();
    });
    const reset = h("sl-button", { variant: "text" }, t("wa.resetDefaults"));
    reset.addEventListener("click", async () => {
      if (!confirm(t("wa.confirmReset"))) return;
      const result = await api<{ commands: PublicCommand[] }>("/api/bot/commands/reset", { method: "POST", body: {} });
      this.#setCommands(result.commands);
    });
    const save = h("sl-button", { variant: "primary" }, t("wa.saveCommands")) as unknown as SlButton & HTMLElement;
    save.addEventListener("click", () => void this.#saveCommands(save));

    box.replaceChildren(
      h("h3", {}, h("sl-icon", { name: "terminal" }), t("wa.commands")),
      h("div", { class: "muted" }, t("wa.commandsHelp")),
      ...this.#commands.map((c, i) => this.#commandEditor(c, i)),
      h("div", { class: "row" }, add, reset, h("span", { class: "grow" }), save),
      message ? h("div", { class: "ok" }, message) : h("span", {}),
      error ? h("div", { class: "err" }, error) : h("span", {}),
    );
  }

  #commandEditor(c: DraftCommand, index: number): HTMLElement {
    const field = (tag: string, props: Record<string, string>, ...children: (Node | string)[]): Field =>
      h(tag, { size: "small", ...props }, ...children) as unknown as Field;

    const trigger = field("sl-input", { label: t("wa.trigger"), value: c.trigger });
    trigger.addEventListener("sl-change", () => { c.trigger = normalizeTrigger(trigger.value) ?? trigger.value; trigger.value = c.trigger; });

    const action = field("sl-select", { label: t("wa.action"), value: c.action, hoist: "" },
      ...COMMAND_ACTIONS.map((a) => h("sl-option", { value: a }, t(`wa.action.${a}` as Key))));
    action.addEventListener("sl-change", () => {
      c.action = action.value as CommandAction;
      if (c.action === "run_routine" && !c.routine) c.routine = { triggerId: "", hasToken: false, token: "" };
      this.#renderCommands();
    });

    const enabled = field("sl-switch", {}, t("wa.enabled"));
    enabled.checked = c.enabled;
    enabled.addEventListener("sl-change", () => { c.enabled = enabled.checked; });

    const del = h("sl-icon-button", { name: "trash", label: t("wa.delete") });
    del.addEventListener("click", () => { this.#commands.splice(index, 1); this.#renderCommands(); });

    const description = field("sl-input", { placeholder: t("wa.description"), value: c.description });
    description.addEventListener("sl-input", () => { c.description = description.value; });

    const editor = h("div", { class: "cmd" }, h("div", { class: "head" }, trigger, action, enabled, del), description);
    if (c.action === "run_routine" && c.routine) editor.append(this.#routineFields(c.routine));
    return editor;
  }

  /** Trigger ID + token for a routine command, with a shortcut to copy them from a chat conversation. */
  #routineFields(routine: NonNullable<DraftCommand["routine"]>): HTMLElement {
    const triggerId = h("sl-input", { size: "small", label: t("wa.routineTrigger"), placeholder: "trig_...", value: routine.triggerId }) as unknown as Field;
    triggerId.addEventListener("sl-input", () => { routine.triggerId = triggerId.value.trim(); });
    const token = h("sl-input", {
      size: "small", type: "password", "password-toggle": "", autocomplete: "off", label: t("wa.routineToken"),
      placeholder: routine.hasToken ? t("wa.tokenSaved") : "sk-ant-oat01-...",
    }) as unknown as Field;
    token.addEventListener("sl-input", () => { routine.token = token.value.trim(); });

    const sources = store.conversations.filter((c) => c.triggerId && c.token);
    const copy = h("sl-dropdown", { hoist: "" },
      h("sl-button", { slot: "trigger", size: "small", caret: "", ...(sources.length ? {} : { disabled: "" }) }, t("wa.copyFrom")),
      h("sl-menu", {}, ...sources.map((c) => h("sl-menu-item", { value: c.id }, c.title || c.triggerId))));
    copy.addEventListener("sl-select", (e) => {
      const source = store.get((e as CustomEvent<{ item: { value: string } }>).detail.item.value);
      if (!source) return;
      routine.triggerId = triggerId.value = source.triggerId;
      routine.token = token.value = source.token;
    });
    return h("div", { class: "routine" }, triggerId, token, copy);
  }

  async #saveCommands(button: SlButton): Promise<void> {
    button.loading = true;
    const payload = this.#commands.map((c) => ({
      ...c,
      ...(c.routine ? { routine: { triggerId: c.routine.triggerId, token: c.routine.token } } : {}),
    }));
    try {
      const result = await api<{ commands: PublicCommand[] }>("/api/bot/commands", { method: "PUT", body: { commands: payload } });
      this.#setCommands(result.commands);
      this.#renderCommands(t("wa.saved"));
    } catch (e) {
      this.#renderCommands("", (e as Error).message);
    } finally {
      button.loading = false;
    }
  }
}

customElements.define("whatsapp-panel", WhatsAppPanel);
