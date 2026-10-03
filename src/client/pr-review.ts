import { store } from "./store.js";
import * as gh from "./github.js";
import type { GhFile, GhPull, GhRepo, GhReview, ReviewEvent } from "./github.js";
import type { SlButton, SlInput, SlTextarea } from "./types.js";

interface SlSelect extends HTMLElement { value: string | string[]; disabled: boolean; placeholder: string }

const REPO_KEY = "routine-chat.repo.v1";
const PREFS_KEY = "routine-chat.repos.v1";

interface RepoPrefs { manual: string[]; /** null = mostrar todos los que devuelve GitHub */ enabled: string[] | null }

function readPrefs(): RepoPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<RepoPrefs>;
    return { manual: p.manual ?? [], enabled: p.enabled ?? null };
  } catch {
    return { manual: [], enabled: null };
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
        .note { white-space:pre-wrap; max-width:560px; margin:auto; }
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
  /** Resultado de la detección de acceso por repo (modo automático). */
  #access = new Map<string, boolean | null>();

  #savePrefs(): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.#prefs)); } catch { /* ignorar */ }
  }

  #renderMain(): void {
    const select = h("sl-select", { placeholder: "Elige un repositorio", clearable: "", hoist: "" }) as unknown as SlSelect;
    const pick = h("sl-button", { size: "small", variant: "primary", outline: "" }, h("sl-icon", { slot: "prefix", name: "list-check" }), "Elegir repos");
    const add = h("sl-icon-button", { name: "plus-lg", label: "Añadir repositorio manualmente" });
    const refresh = h("sl-icon-button", { name: "arrow-clockwise", label: "Actualizar" });
    const diag = h("sl-button", { size: "small", variant: "default" }, h("sl-icon", { slot: "prefix", name: "bug" }), "Diagnóstico");
    const out = h("sl-button", { size: "small", variant: "text" }, `@${this.#login} · Cambiar token`);
    const bar = h("div", { class: "bar" }, select, pick, add, refresh, diag, out);
    const urlInput = h("sl-input", { placeholder: "Pega la URL de un PR (https://github.com/owner/repo/pull/16) o owner/repo#16", size: "small", clearable: "", autocomplete: "off" }) as unknown as SlInput;
    const openBtn = h("sl-button", { size: "small", variant: "primary" }, "Abrir PR") as unknown as HTMLElement & SlButton;
    const openBar = h("div", { class: "bar" }, urlInput, openBtn);
    openBar.querySelector("sl-input")!.setAttribute("style", "flex:1");
    const list = h("div", { class: "list" });
    const detail = h("div", { class: "detail" }, h("div", { class: "center" }, "Elige un repositorio y un Pull Request."));
    const dialog = this.#manualDialog((reload) => (reload ? void this.#loadRepos(select, detail) : this.#populate(select)));
    const diagDialog = this.#diagnosticDialog();
    this.#view.replaceChildren(bar, openBar, h("div", { class: "cols" }, list, detail), dialog, diagDialog);
    this.#view.style.display = "contents";

    out.addEventListener("click", () => {
      if (confirm("¿Quitar el token de GitHub guardado?")) store.setGithubToken("");
    });
    diag.addEventListener("click", () => (diagDialog as unknown as { show(): void }).show());
    add.addEventListener("click", () => (dialog as unknown as { show(): void }).show());
    pick.addEventListener("click", () => {
      const d = this.#pickDialog(() => this.#populate(select));
      this.#view.append(d);
      d.addEventListener("sl-after-hide", () => d.remove());
      (d as unknown as { show(): void }).show();
    });
    refresh.addEventListener("click", () => this.#repo && void this.#loadPulls(this.#repo));
    select.addEventListener("sl-change", () => {
      const v = select.value as string;
      this.#repo = v;
      try { localStorage.setItem(REPO_KEY, v); } catch { /* ignorar */ }
      if (v) void this.#loadPulls(v);
      else { list.replaceChildren(); this.#pulls = []; }
    });
    const openByUrl = async (): Promise<void> => {
      const m = urlInput.value.trim().match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)(?:\/pull\/|#)(\d+)/);
      if (!m) { detail.replaceChildren(h("div", { class: "err" }, "Formato no reconocido. Usa https://github.com/owner/repo/pull/16 o owner/repo#16.")); return; }
      const [, owner, name, num] = m;
      const repo = `${owner}/${name}`;
      openBtn.loading = true;
      detail.replaceChildren(h("div", { class: "center" }, "Cargando…"));
      try {
        const pull = await gh.getPull(store.githubToken, repo, Number(num));
        void pull;
        if (!this.#prefs.manual.includes(repo)) this.#prefs.manual.push(repo);
        this.#savePrefs();
        this.#allRepos = this.#allRepos.some((r) => r.full_name === repo) ? this.#allRepos : [...this.#allRepos, await gh.getRepo(store.githubToken, repo).catch(() => ({ full_name: repo, private: false }))];
        this.#prefs.enabled = this.#prefs.enabled && !this.#prefs.enabled.includes(repo) ? [...this.#prefs.enabled, repo] : this.#prefs.enabled;
        this.#populate(select);
        await customElements.whenDefined("sl-select");
        await (select as unknown as { updateComplete: Promise<unknown> }).updateComplete;
        select.value = repo;
        this.#repo = repo;
        try { localStorage.setItem(REPO_KEY, repo); } catch { /* ignorar */ }
        urlInput.value = "";
        void this.#loadPulls(repo);
        await this.#openPull(repo, Number(num));
      } catch (e) {
        const status = e instanceof gh.GhError ? e.status : 0;
        const why = status === 404 || status === 403
          ? `GitHub responde ${status} para ${repo}#${num}. Con ese código el token no tiene acceso a ese repositorio (si es privado, en GitHub edita el token: Repository access → añade ${repo}; y permisos Pull requests: Read and write, Contents: Read-only). Si el token es de una organización, revisa también el «Resource owner».`
          : (e as Error).message;
        const t = store.githubToken;
        const kind = t.startsWith("github_pat_") ? "fine-grained (github_pat_…)" : t.startsWith("ghp_") ? "classic (ghp_…)" : "desconocido";
        const lines = [why, "", `Token en uso: ${kind}, termina en …${t.slice(-4)}`];
        if (status === 404 || status === 403) {
          for (const path of [`/repos/${repo}`, `/repos/${repo}/pulls/${num}`]) {
            const r = await gh.probe(t, path);
            const msg = (r.body as { message?: string } | null)?.message ?? "";
            lines.push(`GET ${path} → ${r.status} ${msg}${r.headers["x-accepted-github-permissions"] ? ` (permisos que pide: ${r.headers["x-accepted-github-permissions"]})` : ""}`);
          }
        }
        detail.replaceChildren(h("div", { class: "err" }, lines.join("\n")));
      } finally {
        openBtn.loading = false;
      }
    };
    openBtn.addEventListener("click", () => void openByUrl());
    urlInput.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void openByUrl(); });
    void this.#loadRepos(select, detail);
  }

  /** Repos visibles: los elegidos por el usuario (o todos si no eligió), más los añadidos a mano. */
  #visibleRepos(): GhRepo[] {
    const map = new Map<string, GhRepo>();
    const enabled = this.#prefs.enabled ? new Set(this.#prefs.enabled) : null;
    // Modo automático: solo los repos donde la detección confirmó (o no pudo descartar) acceso del token.
    const detected = this.#access.size > 0 && [...this.#access.values()].some((v) => v !== false);
    for (const r of this.#allRepos) {
      const keep = enabled ? enabled.has(r.full_name) : !detected || r.private || this.#access.get(r.full_name) !== false;
      if (keep) map.set(r.full_name, r);
    }
    for (const name of this.#prefs.manual.filter((n) => n.includes("/"))) {
      if (!map.has(name)) map.set(name, this.#allRepos.find((r) => r.full_name === name) ?? { full_name: name, private: false });
    }
    return [...map.values()].sort((a, b) => Number(b.private) - Number(a.private) || a.full_name.localeCompare(b.full_name));
  }

  /** Vuelve a descubrir y detectar (tras cambiar a modo automático). */
  async #reloadAll(): Promise<void> {
    const select = this.#root.querySelector("sl-select") as unknown as SlSelect;
    const detail = this.#detailEl;
    await this.#loadRepos(select, detail);
  }

  #populate(select: SlSelect): void {
    const repos = this.#visibleRepos();
    const manual = new Set(this.#prefs.manual.filter((n) => n.includes("/")));
    select.replaceChildren(...repos.map((r) =>
      h("sl-option", { value: r.full_name }, `${r.private ? "🔒 " : ""}${r.full_name}${r.private ? "" : " · público"}${manual.has(r.full_name) ? " (manual)" : ""}`)));
    if (this.#repo && !repos.some((r) => r.full_name === this.#repo)) {
      select.value = "";
      this.#repo = "";
      this.#listEl.replaceChildren();
      this.#detailEl.replaceChildren(h("div", { class: "center" }, "Elige un repositorio y un Pull Request."));
    }
  }

  /** Diálogo para elegir qué repos mostrar (GitHub no dice cuáles se concedieron al token). */
  #pickDialog(onChange: () => void): HTMLElement {
    const dialog = h("sl-dialog", { label: "Elegir repositorios" });
    const all = [...this.#allRepos].sort((a, b) => Number(b.private) - Number(a.private) || a.full_name.localeCompare(b.full_name));
    const current = this.#prefs.enabled ? new Set(this.#prefs.enabled) : new Set(all.map((r) => r.full_name));
    const boxes = all.map((r) => {
      const cb = h("sl-checkbox", {}, `${r.private ? "🔒 " : ""}${r.full_name}${r.private ? "" : " · público"}`) as HTMLElement & { checked: boolean };
      cb.checked = current.has(r.full_name);
      cb.dataset.repo = r.full_name;
      return cb;
    });
    const status = h("div", { class: "muted" });
    const setAll = (v: boolean): void => boxes.forEach((b) => (b.checked = v));
    const allBtn = h("sl-button", { size: "small" }, "Todos");
    const noneBtn = h("sl-button", { size: "small" }, "Ninguno");
    const detect = h("sl-button", { size: "small" }, "Detectar los del token (experimental)") as HTMLElement & SlButton;
    const autoBtn = h("sl-button", { size: "small", variant: "primary" }, "Automático");
    autoBtn.addEventListener("click", () => {
      this.#prefs.enabled = null;
      this.#savePrefs();
      (dialog as unknown as { hide(): void }).hide();
      void this.#reloadAll();
    });
    allBtn.addEventListener("click", () => setAll(true));
    noneBtn.addEventListener("click", () => setAll(false));
    detect.addEventListener("click", async () => {
      detect.loading = true;
      status.textContent = "Comprobando permisos de cada repositorio…";
      const results = await Promise.all(all.map((r) => gh.probeReviewAccess(store.githubToken, r.full_name)));
      boxes.forEach((b, i) => { if (results[i] !== null) b.checked = results[i] === true; });
      const n = results.filter((x) => x === true).length;
      const u = results.filter((x) => x === null).length;
      status.textContent = `Con permiso de Pull requests en ${n} de ${all.length} repos${u ? ` (${u} no concluyentes, sin cambiar)` : ""}. Revisa la selección y guarda.`;
      detect.loading = false;
    });
    const save = h("sl-button", { slot: "footer", variant: "primary" }, "Guardar");
    save.addEventListener("click", () => {
      const sel = boxes.filter((b) => b.checked).map((b) => b.dataset.repo!);
      this.#prefs.enabled = sel;
      this.#savePrefs();
      onChange();
      (dialog as unknown as { hide(): void }).hide();
    });
    dialog.append(
      h("div", { class: "muted", style: "margin-bottom:8px" }, "Por defecto la app detecta sola en qué repos tiene permiso tu token («Automático»). Si prefieres fijar la lista a mano, marca repos y pulsa Guardar."),
      h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px" }, autoBtn, allBtn, noneBtn, detect),
      status,
      h("div", { style: "display:grid;gap:6px;margin-top:8px;max-height:40vh;overflow:auto" }, ...boxes),
      save);
    return dialog;
  }

  /** Muestra qué responde GitHub (sin el token) para entender por qué faltan repositorios. */
  #diagnosticDialog(): HTMLElement {
    const dialog = h("sl-dialog", { label: "Diagnóstico de repositorios", style: "--width:min(720px,95vw)" });
    const pre = h("pre", { style: "white-space:pre-wrap;word-break:break-word;font:12px/1.5 var(--sl-font-mono);max-height:55vh;overflow:auto;margin:0" });
    const run = async (): Promise<void> => {
      pre.textContent = "Consultando GitHub…";
      const t = store.githubToken;
      const names = (b: unknown): string[] => (Array.isArray(b) ? (b as { full_name?: string; login?: string; private?: boolean }[]).map((x) => `${x.private ? "[privado] " : ""}${x.full_name ?? x.login}`) : []);
      const paths = [
        "/user",
        "/user/repos?per_page=100&affiliation=owner,collaborator,organization_member",
        "/user/repos?per_page=100&visibility=private",
        "/user/orgs?per_page=100",
        "/user/memberships/orgs?per_page=100",
      ];
      const out: string[] = [];
      for (const path of paths) {
        const r = await gh.probe(t, path);
        const list = names(r.body);
        out.push(`GET ${path}\n  estado: ${r.status}`);
        for (const [k, v] of Object.entries(r.headers)) out.push(`  ${k}: ${v}`);
        if (r.status === 200 && path === "/user") out.push(`  usuario: ${(r.body as { login?: string }).login}`);
        else if (r.status === 200) out.push(`  resultados: ${list.length}${list.length ? "\n    " + list.slice(0, 40).join("\n    ") : ""}`);
        else out.push(`  respuesta: ${JSON.stringify(r.body)}`);
        out.push("");
      }
      for (const q of [`is:pr is:open user:${this.#login}`, `is:pr is:open involves:${this.#login}`]) {
        const r = await gh.probe(t, `/search/issues?q=${encodeURIComponent(q)}&per_page=100`);
        const items = ((r.body as { items?: { repository_url: string }[] }).items ?? []).map((i) => i.repository_url.replace(/^.*\/repos\//, ""));
        out.push(`GET /search/issues?q=${q}\n  estado: ${r.status}\n  PRs abiertos: ${items.length}\n  repos: ${[...new Set(items)].join(", ") || "(ninguno)"}\n`);
      }
      out.push("Prueba de permiso de Pull requests por repo (403 = sin permiso concedido; 404/422 = con permiso):");
      const repos = this.#allRepos.slice(0, 60).map((r) => r.full_name);
      const statuses = await Promise.all(repos.map((r) => gh.probeReviewStatus(t, r)));
      repos.forEach((r, i) => out.push(`  ${statuses[i]}  ${r}`));
      pre.textContent = out.join("\n");
    };
    const again = h("sl-button", { slot: "footer", variant: "primary" }, "Volver a ejecutar");
    again.addEventListener("click", () => void run());
    dialog.append(h("div", { class: "muted", style: "margin-bottom:8px" }, "Respuestas crudas de GitHub para tu token (el token no se muestra)."), pre, again);
    dialog.addEventListener("sl-after-show", () => void run());
    return dialog;
  }

  /** Diálogo para añadir/quitar repositorios a mano (p. ej. públicos concedidos al token). */
  #manualDialog(onChange: (reload: boolean) => void): HTMLElement {
    const dialog = h("sl-dialog", { label: "Repositorios manuales" });
    const input = h("sl-input", { placeholder: "owner/repo  ·  u  ·  organización", autocomplete: "off" }) as unknown as SlInput;
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
          onChange(!name.includes("/"));
        });
        return h("div", { style: "display:flex;align-items:center;justify-content:space-between" }, h("span", {}, name), del);
      }));
    };
    const submit = async (): Promise<void> => {
      const name = input.value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
      const isRepo = /^[\w.-]+\/[\w.-]+$/.test(name);
      if (!isRepo && !/^[\w.-]+$/.test(name)) { err.textContent = "Usa owner/repo o solo el nombre del dueño (organización o usuario)."; return; }
      addBtn.loading = true;
      err.textContent = "";
      try {
        let entry = name;
        if (isRepo) entry = (await gh.getRepo(store.githubToken, name)).full_name;
        else await gh.listOwnerRepos(store.githubToken, name); // valida que el dueño existe y es accesible
        if (!this.#prefs.manual.includes(entry)) this.#prefs.manual.push(entry);
        this.#savePrefs();
        input.value = "";
        renderItems();
        onChange(!isRepo);
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
      h("div", { class: "muted", style: "margin-bottom:8px" }, "Si falta algún repositorio, añade aquí un repo concreto (owner/repo) o un dueño completo (por ejemplo el nombre de tu organización) para listar todos sus repos visibles con tu token."),
      h("div", { style: "display:flex;gap:8px" }, input, addBtn), err, h("div", { style: "margin-top:12px" }, items));
    return dialog;
  }

  /** Comprueba, con poca concurrencia, en qué repos tiene permiso de Pull requests el token. */
  async #detectAccess(repos: GhRepo[]): Promise<void> {
    this.#access.clear();
    const queue = repos.slice(0, 150).map((r) => r.full_name);
    const worker = async (): Promise<void> => {
      for (let name = queue.shift(); name; name = queue.shift()) {
        this.#access.set(name, await gh.probeReviewAccess(store.githubToken, name));
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }

  async #loadRepos(select: SlSelect, detail: HTMLElement): Promise<void> {
    const placeholder = (text: string, cls = "center"): void => {
      if (!this.#repo) detail.replaceChildren(h("div", { class: cls }, text));
    };
    try {
      const owners = this.#prefs.manual.filter((n) => !n.includes("/"));
      const { repos: found, warnings } = await gh.discoverRepos(store.githubToken, owners, this.#login);
      this.#allRepos = found;
      if (!this.#prefs.enabled) {
        select.disabled = true;
        select.placeholder = "Detectando repositorios del token…";
        placeholder(`GitHub devolvió ${found.length} repositorios. Detectando en cuáles tiene permiso tu token…`);
        await this.#detectAccess(found);
        select.disabled = false;
        select.placeholder = "Elige un repositorio";
      }
      this.#populate(select);
      const repos = this.#visibleRepos();
      let saved = "";
      try { saved = localStorage.getItem(REPO_KEY) ?? ""; } catch { /* ignorar */ }
      if (!this.#repo && repos.some((r) => r.full_name === saved)) {
        await customElements.whenDefined("sl-select");
        await (select as unknown as { updateComplete: Promise<unknown> }).updateComplete;
        select.value = saved;
        this.#repo = saved;
        void this.#loadPulls(saved);
      }
      const shown = this.#visibleRepos().length;
      const lines = [`GitHub devolvió ${found.length} repositorios.`];
      if (!this.#prefs.enabled) {
        const confirmed = [...this.#access.values()].filter((v) => v === true).length;
        lines.push(this.#access.size && [...this.#access.values()].some((v) => v !== false)
          ? `Detección automática: ${shown} con permiso de Pull requests del token (${confirmed} confirmados).`
          : "La detección no pudo confirmar acceso en ninguno, así que se muestran todos. Revisa «Diagnóstico».");
      }
      const priv = found.filter((r) => r.private).length;
      if (priv === 0) {
        lines.push("Ningún repositorio privado: GitHub no devuelve ninguno para este token ni en la búsqueda de PRs. Eso ocurre si el token no tiene concedido ningún repo privado: en GitHub → Settings → Developer settings → Fine-grained tokens → tu token, revisa «Resource owner» (tu usuario u organización) y «Repository access» (debe ser «All repositories» u «Only select repositories» con tus privados marcados, no «Public repositories»).");
      }
      lines.push(...warnings);
      placeholder(lines.join("\n"), "center note");
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
