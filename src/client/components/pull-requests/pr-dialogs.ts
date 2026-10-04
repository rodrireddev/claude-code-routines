/** Dialogs of the Pull requests view: choose repos, add repos by hand, and diagnostics. */
import { h } from "../../core/dom.js";
import { t } from "../../core/i18n.js";
import { githubAuth } from "../../core/github-auth.js";
import * as gh from "../../services/github.js";
import type { GhRepo } from "../../services/github.js";
import type { SlButton, SlInput } from "../../core/types.js";
import type { RepoPrefs } from "./repo-prefs.js";

/** What the dialogs need from the Pull requests view. */
export interface RepoContext {
  prefs: RepoPrefs;
  savePrefs(): void;
  allRepos(): GhRepo[];
  login(): string;
  reloadAll(): Promise<void>;
}

/** Diálogo para elegir qué repos mostrar (GitHub no dice cuáles se concedieron al token). */
export function pickReposDialog(ctx: RepoContext, onChange: () => void): HTMLElement {
  const dialog = h("sl-dialog", { label: t("pick.title") });
  const all = [...ctx.allRepos()].sort((a, b) => Number(b.private) - Number(a.private) || a.full_name.localeCompare(b.full_name));
  const current = ctx.prefs.enabled ? new Set(ctx.prefs.enabled) : new Set(all.map((r) => r.full_name));
  const boxes = all.map((r) => {
    const cb = h("sl-checkbox", {}, `${r.private ? "🔒 " : ""}${r.full_name}${r.private ? "" : t("pr.public")}`) as HTMLElement & { checked: boolean };
    cb.checked = current.has(r.full_name);
    cb.dataset.repo = r.full_name;
    return cb;
  });
  const status = h("div", { class: "muted" });
  const setAll = (v: boolean): void => boxes.forEach((b) => (b.checked = v));
  const allBtn = h("sl-button", { size: "small" }, t("pick.all"));
  const noneBtn = h("sl-button", { size: "small" }, t("pick.none"));
  const detect = h("sl-button", { size: "small" }, t("pick.detect")) as HTMLElement & SlButton;
  const autoBtn = h("sl-button", { size: "small", variant: "primary" }, t("pick.auto"));
  autoBtn.addEventListener("click", () => {
    ctx.prefs.enabled = null;
    ctx.savePrefs();
    (dialog as unknown as { hide(): void }).hide();
    void ctx.reloadAll();
  });
  allBtn.addEventListener("click", () => setAll(true));
  noneBtn.addEventListener("click", () => setAll(false));
  detect.addEventListener("click", async () => {
    detect.loading = true;
    status.textContent = t("pick.checking");
    const results = await Promise.all(all.map((r) => gh.probeReviewAccess(githubAuth.token, r.full_name)));
    boxes.forEach((b, i) => { if (results[i] !== null) b.checked = results[i] === true; });
    const n = results.filter((x) => x === true).length;
    const u = results.filter((x) => x === null).length;
    status.textContent = t("pick.result", { n, total: all.length, unknown: u ? t("pick.unknown", { u }) : "" });
    detect.loading = false;
  });
  const save = h("sl-button", { slot: "footer", variant: "primary" }, t("pick.save"));
  save.addEventListener("click", () => {
    const sel = boxes.filter((b) => b.checked).map((b) => b.dataset.repo!);
    ctx.prefs.enabled = sel;
    ctx.savePrefs();
    onChange();
    (dialog as unknown as { hide(): void }).hide();
  });
  dialog.append(
    h("div", { class: "muted", style: "margin-bottom:8px" }, t("pick.help")),
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px" }, autoBtn, allBtn, noneBtn, detect),
    status,
    h("div", { style: "display:grid;gap:6px;margin-top:8px;max-height:40vh;overflow:auto" }, ...boxes),
    save);
  return dialog;
}

/** Muestra qué responde GitHub (sin el token) para entender por qué faltan repositorios. */
export function diagnosticsDialog(ctx: RepoContext): HTMLElement {
  const dialog = h("sl-dialog", { label: t("diag.title"), style: "--width:min(720px,95vw)" });
  const pre = h("pre", { style: "white-space:pre-wrap;word-break:break-word;font:12px/1.5 var(--sl-font-mono);max-height:55vh;overflow:auto;margin:0" });
  const run = async (): Promise<void> => {
    pre.textContent = t("diag.querying");
    const tok = githubAuth.token;
    const names = (b: unknown): string[] => (Array.isArray(b) ? (b as { full_name?: string; login?: string; private?: boolean }[]).map((x) => `${x.private ? t("diag.private") : ""}${x.full_name ?? x.login}`) : []);
    const paths = [
      "/user",
      "/user/repos?per_page=100&affiliation=owner,collaborator,organization_member",
      "/user/repos?per_page=100&visibility=private",
      "/user/orgs?per_page=100",
      "/user/memberships/orgs?per_page=100",
    ];
    const out: string[] = [];
    for (const path of paths) {
      const r = await gh.probe(tok, path);
      const list = names(r.body);
      out.push(`GET ${path}\n  ${t("diag.status")}: ${r.status}`);
      for (const [k, v] of Object.entries(r.headers)) out.push(`  ${k}: ${v}`);
      if (r.status === 200 && path === "/user") out.push(`  ${t("diag.user")}: ${(r.body as { login?: string }).login}`);
      else if (r.status === 200) out.push(`  ${t("diag.results")}: ${list.length}${list.length ? "\n    " + list.slice(0, 40).join("\n    ") : ""}`);
      else out.push(`  ${t("diag.response")}: ${JSON.stringify(r.body)}`);
      out.push("");
    }
    for (const q of [`is:pr is:open user:${ctx.login()}`, `is:pr is:open involves:${ctx.login()}`]) {
      const r = await gh.probe(tok, `/search/issues?q=${encodeURIComponent(q)}&per_page=100`);
      const items = ((r.body as { items?: { repository_url: string }[] }).items ?? []).map((i) => i.repository_url.replace(/^.*\/repos\//, ""));
      out.push(`GET /search/issues?q=${q}\n  ${t("diag.status")}: ${r.status}\n  ${t("diag.openPrs")}: ${items.length}\n  ${t("diag.repos")}: ${[...new Set(items)].join(", ") || t("diag.none")}\n`);
    }
    out.push(t("diag.probe"));
    const repos = ctx.allRepos().slice(0, 60).map((r) => r.full_name);
    const statuses = await Promise.all(repos.map((r) => gh.probeReviewStatus(tok, r)));
    repos.forEach((r, i) => out.push(`  ${statuses[i]}  ${r}`));
    pre.textContent = out.join("\n");
  };
  const again = h("sl-button", { slot: "footer", variant: "primary" }, t("diag.again"));
  again.addEventListener("click", () => void run());
  dialog.append(h("div", { class: "muted", style: "margin-bottom:8px" }, t("diag.help")), pre, again);
  dialog.addEventListener("sl-after-show", () => void run());
  return dialog;
}

/** Diálogo para añadir/quitar repositorios a mano (p. ej. públicos concedidos al token). */
export function manualReposDialog(ctx: RepoContext, onChange: (reload: boolean) => void): HTMLElement {
  const dialog = h("sl-dialog", { label: t("man.title") });
  const input = h("sl-input", { placeholder: t("man.placeholder"), autocomplete: "off" }) as unknown as SlInput;
  const err = h("div", { class: "err" });
  const addBtn = h("sl-button", { variant: "primary" }, t("man.add")) as unknown as HTMLElement & SlButton;
  const items = h("div", { style: "display:grid;gap:4px" });
  const renderItems = (): void => {
    items.replaceChildren(...ctx.prefs.manual.map((name) => {
      const del = h("sl-icon-button", { name: "trash", label: t("man.remove") });
      del.addEventListener("click", () => {
        ctx.prefs.manual = ctx.prefs.manual.filter((n) => n !== name);
        ctx.savePrefs();
        renderItems();
        onChange(!name.includes("/"));
      });
      return h("div", { style: "display:flex;align-items:center;justify-content:space-between" }, h("span", {}, name), del);
    }));
  };
  const submit = async (): Promise<void> => {
    const name = input.value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    const isRepo = /^[\w.-]+\/[\w.-]+$/.test(name);
    if (!isRepo && !/^[\w.-]+$/.test(name)) { err.textContent = t("man.badFormat"); return; }
    addBtn.loading = true;
    err.textContent = "";
    try {
      let entry = name;
      if (isRepo) entry = (await gh.getRepo(githubAuth.token, name)).full_name;
      else await gh.listOwnerRepos(githubAuth.token, name); // valida que el dueño existe y es accesible
      if (!ctx.prefs.manual.includes(entry)) ctx.prefs.manual.push(entry);
      ctx.savePrefs();
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
    h("div", { class: "muted", style: "margin-bottom:8px" }, t("man.help")),
    h("div", { style: "display:flex;gap:8px" }, input, addBtn), err, h("div", { style: "margin-top:12px" }, items));
  return dialog;
}
