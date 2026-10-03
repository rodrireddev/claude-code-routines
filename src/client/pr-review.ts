import { store } from "./store.js";
import * as gh from "./github.js";
import type { GhFile, GhPull, GhRepo, GhReview, ReviewEvent } from "./github.js";
import type { SlButton, SlInput, SlTextarea } from "./types.js";

interface SlSelect extends HTMLElement { value: string | string[]; disabled: boolean }

const REPO_KEY = "routine-chat.repo.v1";
const PREFS_KEY = "routine-chat.repos.v1";

interface RepoPrefs { manual: string[]; showPublic: boolean }

function readPrefs(): RepoPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<RepoPrefs>;
    return { manual: p.manual ?? [], showPublic: p.showPublic ?? false };
  } catch {
    return { manual: [], showPublic: false };
  }
}
const MAX_DIFF_LINES = 500;

/** Crea un elemento; los hijos string se insertan como texto (nunca como HTML). */
function h(tag: string, props: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) el.setAttribute(k, v);
  for (const c of children) if (c !== null) el.append(c);
  return el;
}

const ago = (iso: string): string => new Date(iso).toLocaleString();

/** <pr-review> — revisa y aprueba Pull Requests de GitHub con un fine-grained token. */
export class PrReview extends HTMLElement {
  #root!: ShadowRoot;
  #repo = "";
  #pulls: GhPull[] = [];
  #current: GhPull | null = null;
  #login = "";

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    this.#root.innerHTML = `
      <style>
        :host { display:flex; flex-direction:column; min-height:0; flex:1; }
        .setup { max-width:520px; margin:auto; padding:var(--sl-spacing-large); display:grid; gap:var(--sl-spacing-medium); }
        .setup h2 { margin:0; }
        .setup ul { margin:0; padding-left:1.2em; color:var(--sl-color-neutral-600); font-size:var(--sl-font-size-small); }
        .muted { color:var(--sl-color-neutral-500); font-size:var(--sl-font-size-small); }
        .err { color:var(--sl-color-danger-600); font-size:var(--sl-font-size-small); white-space:pre-wrap; }
        .bar { display:flex; gap:var(--sl-spacing-small); align-items:center; padding:var(--sl-spacing-x-small) var(--sl-spacing-medium); border-bottom:1px solid var(--sl-color-neutral-200); }
        .bar sl-select { flex:1; min-width:0; }
        .cols { display:flex; flex:1; min-height:0; }
        .list { width:300px; flex:none; overflow-y:auto; border-right:1px solid var(--sl-color-neutral-200); }
        .pr { padding:var(--sl-spacing-small) var(--sl-spacing-medium); cursor:pointer; border-bottom:1px solid var(--sl-color-neutral-100); }
        .pr:hover { background:var(--sl-color-neutral-100); }
        .pr.sel { background:var(--sl-color-neutral-200); }
        .pr b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .detail { flex:1; min-width:0; overflow-y:auto; padding:var(--sl-spacing-medium); display:grid; gap:var(--sl-spacing-medium); align-content:start; }
        .detail h2 { margin:0; font-size:var(--sl-font-size-x-large); }
        .meta { display:flex; gap:var(--sl-spacing-small); flex-wrap:wrap; align-items:center; color:var(--sl-color-neutral-600); font-size:var(--sl-font-size-small); }
        .body { white-space:pre-wrap; word-break:break-word; background:var(--sl-color-neutral-50); border:1px solid var(--sl-color-neutral-200); border-radius:var(--sl-border-radius-large); padding:var(--sl-spacing-small) var(--sl-spacing-medium); }
        h3 { margin:0; font-size:var(--sl-font-size-medium); }
        .review { font-size:var(--sl-font-size-small); display:flex; gap:var(--sl-spacing-x-small); align-items:baseline; flex-wrap:wrap; }
        pre.diff { margin:0; overflow-x:auto; font:12px/1.5 var(--sl-font-mono); }
        .diff span { display:block; padding:0 var(--sl-spacing-small); white-space:pre; }
        .diff .add { background:color-mix(in srgb, var(--sl-color-success-500) 18%, transparent); }
        .diff .del { background:color-mix(in srgb, var(--sl-color-danger-500) 18%, transparent); }
        .diff .hunk { color:var(--sl-color-primary-700); background:var(--sl-color-primary-50); }
        .form { display:grid; gap:var(--sl-spacing-small); position:sticky; bottom:0; background:var(--sl-color-neutral-0); padding:var(--sl-spacing-small) 0; border-top:1px solid var(--sl-color-neutral-200); }
        .actions { display:flex; gap:var(--sl-spacing-small); flex-wrap:wrap; }
        .ok { color:var(--sl-color-success-700); font-size:var(--sl-font-size-small); }
        .center { margin:auto; text-align:center; color:var(--sl-color-neutral-500); padding:var(--sl-spacing-large); }
        @media (max-width:800px) { .list { width:200px; } }
      </style>
      <div id="view"></div>`;
  }

  connectedCallback(): void {
    store.addEventListener("github", () => void this.#render());
    void this.#render();
  }

  get #view(): HTMLElement {
    return this.#root.getElementById("view")!;
  }

  async #render(): Promise<void> {
    const view = this.#view;
    view.style.display = "contents";
    if (!store.githubToken) return this.#renderSetup();
    try {
      this.#login = (await gh.getUser(store.githubToken)).login;
    } catch (e) {
      this.#renderSetup((e as Error).message);
      return;
    }
    this.#renderMain();
  }

  // ---- Configuración del token -------------------------------------------------

  #renderSetup(error = ""): void {
    const input = h("sl-input", { type: "password", label: "Fine-grained personal access token", placeholder: "github_pat_...", "password-toggle": "", autocomplete: "off" }) as unknown as SlInput;
    const err = h("div", { class: "err" }, error);
    const btn = h("sl-button", { variant: "primary" }, "Guardar token") as unknown as SlButton & HTMLElement;
    const save = async (): Promise<void> => {
      const token = input.value.trim();
      if (!token) return;
      btn.loading = true;
      err.textContent = "";
      try {
        await gh.getUser(token);
        store.setGithubToken(token);
      } catch (e) {
        err.textContent = (e as Error).message;
      } finally {
        btn.loading = false;
      }
    };
    btn.addEventListener("click", () => void save());
    input.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void save(); });
    const box = h("div", { class: "setup" },
      h("h2", {}, "Conecta GitHub"),
      h("div", { class: "muted" }, "Crea un fine-grained token en GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens, limitado a los repositorios que quieras revisar, con estos permisos:"),
      h("ul", {},
        h("li", {}, "Pull requests: Read and write (para revisar y aprobar)"),
        h("li", {}, "Contents: Read-only (para ver los diffs)"),
        h("li", {}, "Metadata: Read-only (se añade solo)")),
      input, err, btn,
      h("div", { class: "muted" }, "El token se guarda como el resto de tus datos locales (cifrado si activaste el cifrado) y solo se envía a api.github.com."));
    this.#view.replaceChildren(box);
    this.#view.style.display = "contents";
  }

  // ---- Vista principal -------------------------------------------------------

  #prefs = readPrefs();
  #allRepos: GhRepo[] = [];

  #savePrefs(): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.#prefs)); } catch { /* ignorar */ }
  }

  #renderMain(): void {
    const select = h("sl-select", { placeholder: "Elige un repositorio", clearable: "", hoist: "" }) as unknown as SlSelect;
    const publics = h("sl-checkbox", { size: "small" }, "Públicos") as HTMLElement & { checked: boolean };
    publics.checked = this.#prefs.showPublic;
    const add = h("sl-icon-button", { name: "plus-lg", label: "Añadir repositorio manualmente" });
    const refresh = h("sl-icon-button", { name: "arrow-clockwise", label: "Actualizar" });
    const out = h("sl-button", { size: "small", variant: "text" }, `@${this.#login} · Cambiar token`);
    const bar = h("div", { class: "bar" }, select, publics, add, refresh, out);
    const list = h("div", { class: "list" });
    const detail = h("div", { class: "detail" }, h("div", { class: "center" }, "Elige un repositorio y un Pull Request."));
    const dialog = this.#manualDialog(() => this.#populate(select));
    this.#view.replaceChildren(bar, h("div", { class: "cols" }, list, detail), dialog);
    this.#view.style.display = "contents";

    out.addEventListener("click", () => {
      if (confirm("¿Quitar el token de GitHub guardado?")) store.setGithubToken("");
    });
    add.addEventListener("click", () => (dialog as unknown as { show(): void }).show());
    publics.addEventListener("sl-change", () => {
      this.#prefs.showPublic = publics.checked;
      this.#savePrefs();
      this.#populate(select);
    });
    refresh.addEventListener("click", () => this.#repo && void this.#loadPulls(this.#repo));
    select.addEventListener("sl-change", () => {
      const v = select.value as string;
      this.#repo = v;
      try { localStorage.setItem(REPO_KEY, v); } catch { /* ignorar */ }
      if (v) void this.#loadPulls(v);
      else { list.replaceChildren(); this.#pulls = []; }
    });
    void this.#loadRepos(select, detail);
  }

  /** Repos visibles: privados (solo llegan los concedidos al token), públicos si se pide, y los añadidos a mano. */
  #visibleRepos(): GhRepo[] {
    const map = new Map<string, GhRepo>();
    for (const r of this.#allRepos) if (r.private || this.#prefs.showPublic) map.set(r.full_name, r);
    for (const name of this.#prefs.manual) {
      if (!map.has(name)) map.set(name, this.#allRepos.find((r) => r.full_name === name) ?? { full_name: name, private: false });
    }
    return [...map.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  #populate(select: SlSelect): void {
    const repos = this.#visibleRepos();
    const manual = new Set(this.#prefs.manual);
    select.replaceChildren(...repos.map((r) =>
      h("sl-option", { value: r.full_name }, `${r.private ? "🔒 " : ""}${r.full_name}${manual.has(r.full_name) ? " (manual)" : ""}`)));
    if (this.#repo && !repos.some((r) => r.full_name === this.#repo)) {
      select.value = "";
      this.#repo = "";
      this.#listEl.replaceChildren();
      this.#detailEl.replaceChildren(h("div", { class: "center" }, "Elige un repositorio y un Pull Request."));
    }
  }

  /** Diálogo para añadir/quitar repositorios a mano (p. ej. públicos concedidos al token). */
  #manualDialog(onChange: () => void): HTMLElement {
    const dialog = h("sl-dialog", { label: "Repositorios manuales" });
    const input = h("sl-input", { placeholder: "owner/repo", autocomplete: "off" }) as unknown as SlInput;
    const err = h("div", { class: "err" });
    const addBtn = h("sl-button", { variant: "primary" }, "Añadir") as unknown as HTMLElement & SlButton;
    const items = h("div", { style: "display:grid;gap:4px" });
    const renderItems = (): void => {
      items.replaceChildren(...this.#prefs.manual.map((name) => {
        const del = h("sl-icon-button", { name: "trash", label: "Quitar" });
        del.addEventListener("click", () => {
          this.#prefs.manual = this.#prefs.manual.filter((n) => n !== name);
          this.#savePrefs();
          renderItems();
          onChange();
        });
        return h("div", { style: "display:flex;align-items:center;justify-content:space-between" }, h("span", {}, name), del);
      }));
    };
    const submit = async (): Promise<void> => {
      const name = input.value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
      if (!/^[\w.-]+\/[\w.-]+$/.test(name)) { err.textContent = "Usa el formato owner/repo."; return; }
      addBtn.loading = true;
      err.textContent = "";
      try {
        const repo = await gh.getRepo(store.githubToken, name);
        if (!this.#prefs.manual.includes(repo.full_name)) this.#prefs.manual.push(repo.full_name);
        this.#savePrefs();
        input.value = "";
        renderItems();
        onChange();
      } catch (e) {
        err.textContent = (e as Error).message;
      } finally {
        addBtn.loading = false;
      }
    };
    addBtn.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void submit(); });
    renderItems();
    dialog.append(
      h("div", { class: "muted", style: "margin-bottom:8px" }, "Un fine-grained token siempre puede leer repos públicos, aunque no se los hayas concedido. La lista automática solo muestra los privados; añade aquí a mano los públicos (u otros) que quieras revisar."),
      h("div", { style: "display:flex;gap:8px" }, input, addBtn), err, h("div", { style: "margin-top:12px" }, items));
    return dialog;
  }

  async #loadRepos(select: SlSelect, detail: HTMLElement): Promise<void> {
    try {
      this.#allRepos = await gh.listRepos(store.githubToken);
      this.#populate(select);
      const repos = this.#visibleRepos();
      let saved = "";
      try { saved = localStorage.getItem(REPO_KEY) ?? ""; } catch { /* ignorar */ }
      if (repos.some((r) => r.full_name === saved)) {
        await customElements.whenDefined("sl-select");
        await (select as unknown as { updateComplete: Promise<unknown> }).updateComplete;
        select.value = saved;
        this.#repo = saved;
        void this.#loadPulls(saved);
      } else if (repos.length === 0) {
        detail.replaceChildren(h("div", { class: "center" },
          "No hay repositorios privados accesibles con este token. Añade uno con «+» (owner/repo) o marca «Públicos»."));
      }
    } catch (e) {
      detail.replaceChildren(h("div", { class: "err" }, (e as Error).message));
    }
  }

  get #listEl(): HTMLElement { return this.#root.querySelector(".list")!; }
  get #detailEl(): HTMLElement { return this.#root.querySelector(".detail")!; }

  async #loadPulls(repo: string): Promise<void> {
    const list = this.#listEl;
    list.replaceChildren(h("div", { class: "center" }, "Cargando…"));
    try {
      this.#pulls = await gh.listPulls(store.githubToken, repo);
    } catch (e) {
      list.replaceChildren(h("div", { class: "err", style: "padding:12px" }, (e as Error).message));
      return;
    }
    if (repo !== this.#repo) return;
    if (this.#pulls.length === 0) {
      list.replaceChildren(h("div", { class: "center" }, "No hay Pull Requests abiertos."));
      return;
    }
    list.replaceChildren(...this.#pulls.map((p) => {
      const el = h("div", { class: "pr" + (this.#current?.number === p.number ? " sel" : "") },
        h("b", {}, p.title),
        h("span", { class: "muted" }, `#${p.number} · ${p.user.login}${p.draft ? " · borrador" : ""}`));
      el.addEventListener("click", () => {
        list.querySelectorAll(".pr").forEach((x) => x.classList.remove("sel"));
        el.classList.add("sel");
        void this.#openPull(repo, p.number);
      });
      return el;
    }));
  }

  async #openPull(repo: string, number: number, notice = ""): Promise<void> {
    const detail = this.#detailEl;
    detail.replaceChildren(h("div", { class: "center" }, "Cargando…"));
    const t = store.githubToken;
    try {
      const [pull, files, reviews] = await Promise.all([
        gh.getPull(t, repo, number),
        gh.listFiles(t, repo, number),
        gh.listReviews(t, repo, number),
      ]);
      if (repo !== this.#repo) return;
      this.#current = pull;
      this.#renderDetail(repo, pull, files, reviews, notice);
    } catch (e) {
      detail.replaceChildren(h("div", { class: "err" }, (e as Error).message));
    }
  }

  #renderDetail(repo: string, pull: GhPull, files: GhFile[], reviews: GhReview[], notice: string): void {
    const link = h("a", { href: pull.html_url, target: "_blank", rel: "noopener noreferrer" }, "Abrir en GitHub");
    const head = h("div", { class: "meta" },
      h("sl-badge", { variant: pull.draft ? "neutral" : "success" }, pull.draft ? "Borrador" : "Abierto"),
      h("span", {}, `#${pull.number} · ${pull.user.login} · ${ago(pull.created_at)}`),
      h("span", {}, `${pull.base.ref} ← ${pull.head.ref}`),
      h("span", {}, `+${pull.additions ?? 0} −${pull.deletions ?? 0} · ${pull.changed_files ?? files.length} archivos`),
      link);

    const reviewsEl = reviews.length
      ? h("div", { style: "display:grid;gap:4px" }, h("h3", {}, "Reviews"), ...reviews.map((r) =>
          h("div", { class: "review" },
            h("sl-badge", { variant: r.state === "APPROVED" ? "success" : r.state === "CHANGES_REQUESTED" ? "danger" : "neutral" }, r.state),
            h("b", {}, r.user.login),
            r.body ? h("span", {}, r.body) : null)))
      : null;

    const filesEl = h("div", { style: "display:grid;gap:6px" }, h("h3", {}, `Archivos cambiados (${files.length})`),
      ...files.map((f) => {
        const pre = h("pre", { class: "diff" });
        const lines = (f.patch ?? "(sin diff: archivo binario o demasiado grande)").split("\n");
        for (const line of lines.slice(0, MAX_DIFF_LINES)) {
          const cls = line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "";
          pre.append(h("span", cls ? { class: cls } : {}, line || " "));
        }
        if (lines.length > MAX_DIFF_LINES) pre.append(h("span", { class: "hunk" }, `… ${lines.length - MAX_DIFF_LINES} líneas más (ver en GitHub)`));
        return h("sl-details", { summary: `${f.filename}  (+${f.additions} −${f.deletions})` }, pre);
      }));

    const textarea = h("sl-textarea", { rows: "3", resize: "auto", placeholder: "Comentario de la review (obligatorio para «Solicitar cambios» y «Comentar»)" }) as unknown as SlTextarea;
    const status = h("div", notice ? { class: "ok" } : {}, notice);
    const btn = (label: string, variant: string, ev: ReviewEvent, icon: string): HTMLElement & SlButton => {
      const b = h("sl-button", { variant }, h("sl-icon", { slot: "prefix", name: icon }), label) as unknown as HTMLElement & SlButton;
      b.addEventListener("click", () => void this.#submit(repo, pull, ev, textarea, status, buttons));
      return b;
    };
    const buttons = [
      btn("Aprobar", "success", "APPROVE", "check-lg"),
      btn("Solicitar cambios", "danger", "REQUEST_CHANGES", "x-lg"),
      btn("Comentar", "default", "COMMENT", "chat-left-text"),
    ];
    const form = h("div", { class: "form" }, textarea, h("div", { class: "actions" }, ...buttons), status);

    this.#detailEl.replaceChildren(
      h("h2", {}, pull.title), head,
      pull.body ? h("div", { class: "body" }, pull.body) : h("div", { class: "muted" }, "Sin descripción."),
      ...(reviewsEl ? [reviewsEl] : []), filesEl, form);
    this.#detailEl.scrollTop = 0;
  }

  async #submit(repo: string, pull: GhPull, event: ReviewEvent, textarea: SlTextarea, status: HTMLElement, buttons: SlButton[]): Promise<void> {
    const body = textarea.value.trim();
    status.className = "err";
    if (event !== "APPROVE" && !body) { status.textContent = "Escribe un comentario para esta acción."; return; }
    const verb = { APPROVE: "aprobar", REQUEST_CHANGES: "solicitar cambios en", COMMENT: "comentar" }[event];
    if (!confirm(`¿Seguro que quieres ${verb} el PR #${pull.number} (${repo})?`)) return;
    buttons.forEach((b) => (b.loading = true));
    status.textContent = "";
    try {
      await gh.submitReview(store.githubToken, repo, pull.number, event, body, pull.head.sha);
      await this.#openPull(repo, pull.number, "✓ Review enviada.");
    } catch (e) {
      status.textContent = (e as Error).message;
    } finally {
      buttons.forEach((b) => (b.loading = false));
    }
  }
}

customElements.define("pr-review", PrReview);
