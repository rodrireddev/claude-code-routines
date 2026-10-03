/** Cliente mínimo de la API REST de GitHub (fine-grained PAT). Se llama directo desde el cliente. */

const API = "https://api.github.com";

export interface GhRepo { full_name: string; private: boolean }
export interface GhPull {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  html_url: string;
  user: { login: string };
  head: { sha: string; ref: string };
  base: { ref: string };
  created_at: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  mergeable_state?: string;
}
export interface GhFile { filename: string; status: string; additions: number; deletions: number; patch?: string }
export interface GhReview { id: number; user: { login: string }; state: string; body: string; submitted_at?: string }
export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export class GhError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { message?: string; errors?: unknown[] };
      msg = j.message ?? msg;
      if (j.errors?.length) msg += ` ${JSON.stringify(j.errors)}`;
    } catch { /* sin cuerpo */ }
    if (res.status === 401) msg = "Token inválido o expirado.";
    else if (res.status === 403 || res.status === 404) msg += " (¿el token tiene acceso a ese repositorio y permiso de Pull requests?)";
    throw new GhError(res.status, msg);
  }
  return (await res.json()) as T;
}

export const getUser = (t: string) => gh<{ login: string }>(t, "/user");

/**
 * Repositorios que devuelve GitHub para el token. Ojo: un fine-grained token siempre puede leer
 * repos públicos, así que esta lista incluye públicos aunque no estén concedidos al token.
 */
export async function listRepos(t: string): Promise<GhRepo[]> {
  const all: GhRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const chunk = await gh<GhRepo[]>(t, `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`);
    all.push(...chunk);
    if (chunk.length < 100) break;
  }
  return all;
}

/** Repos de un dueño (organización o usuario) que el token puede ver. */
export async function listOwnerRepos(t: string, owner: string): Promise<GhRepo[]> {
  const fetchAll = async (base: string): Promise<GhRepo[]> => {
    const all: GhRepo[] = [];
    for (let page = 1; page <= 5; page++) {
      const chunk = await gh<GhRepo[]>(t, `${base}${base.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      all.push(...chunk);
      if (chunk.length < 100) break;
    }
    return all;
  };
  try {
    return await fetchAll(`/orgs/${owner}/repos?type=all`);
  } catch {
    return fetchAll(`/users/${owner}/repos?type=all`);
  }
}

export interface RepoDiscovery { repos: GhRepo[]; warnings: string[] }

/**
 * Junta todo lo que se puede descubrir: /user/repos, los repos de cada organización del usuario
 * y los dueños que el usuario añadió a mano. Los errores parciales se devuelven como avisos.
 */
export async function discoverRepos(t: string, extraOwners: string[], login = ""): Promise<RepoDiscovery> {
  const map = new Map<string, GhRepo>();
  const warnings: string[] = [];
  const add = (list: GhRepo[]): void => list.forEach((r) => map.set(r.full_name, r));

  add(await listRepos(t));

  let orgs: string[] = [];
  try {
    orgs = (await gh<{ login: string }[]>(t, "/user/orgs?per_page=100")).map((o) => o.login);
  } catch (e) {
    warnings.push(`No se pudieron listar tus organizaciones: ${(e as Error).message}`);
  }
  const owners = [...new Set([...orgs, ...extraOwners])];
  const results = await Promise.allSettled(owners.map((o) => listOwnerRepos(t, o)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") add(r.value);
    else warnings.push(`No se pudieron listar los repos de ${owners[i]}: ${(r.reason as Error).message}`);
  });

  // Búsqueda de PRs abiertos: respeta el acceso del token, así que también revela repos privados
  // (o de organizaciones) que /user/repos no lista.
  try {
    const known = new Set(map.keys());
    const names = await searchPullRepos(t, [...new Set([login, ...extraOwners, ...orgs].filter(Boolean))], login);
    const missing = names.filter((n) => !known.has(n)).slice(0, 100);
    const fetched = await Promise.allSettled(missing.map((n) => getRepo(t, n)));
    fetched.forEach((r) => { if (r.status === "fulfilled") map.set(r.value.full_name, r.value); });
  } catch (e) {
    warnings.push(`La búsqueda de PRs falló: ${(e as Error).message}`);
  }
  return { repos: [...map.values()], warnings };
}

interface SearchItem { repository_url: string }

/** Repos (owner/name) que tienen PRs abiertos visibles para el token. */
export async function searchPullRepos(t: string, owners: string[], login: string): Promise<string[]> {
  const queries = [
    ...owners.map((o) => `is:pr is:open user:${o}`),
    ...(login ? [`is:pr is:open involves:${login}`, `is:pr is:open review-requested:${login}`] : []),
  ];
  const names = new Set<string>();
  for (const q of queries) {
    for (let page = 1; page <= 3; page++) {
      const res = await gh<{ items: SearchItem[] }>(t, `/search/issues?q=${encodeURIComponent(q)}&per_page=100&page=${page}`);
      for (const it of res.items) names.add(it.repository_url.replace(/^.*\/repos\//, ""));
      if (res.items.length < 100) break;
    }
  }
  return [...names];
}

export const getRepo = (t: string, fullName: string) => gh<GhRepo>(t, `/repos/${fullName}`);

export const listPulls = (t: string, repo: string) =>
  gh<GhPull[]>(t, `/repos/${repo}/pulls?state=open&per_page=50&sort=updated&direction=desc`);

export const getPull = (t: string, repo: string, n: number) => gh<GhPull>(t, `/repos/${repo}/pulls/${n}`);

export async function listFiles(t: string, repo: string, n: number): Promise<GhFile[]> {
  const all: GhFile[] = [];
  for (let page = 1; page <= 3; page++) {
    const chunk = await gh<GhFile[]>(t, `/repos/${repo}/pulls/${n}/files?per_page=100&page=${page}`);
    all.push(...chunk);
    if (chunk.length < 100) break;
  }
  return all;
}

export const listReviews = (t: string, repo: string, n: number) =>
  gh<GhReview[]>(t, `/repos/${repo}/pulls/${n}/reviews?per_page=100`);

/** Envía una review. `commitId` fija la revisión al commit que se estaba viendo. */
export const submitReview = (t: string, repo: string, n: number, event: ReviewEvent, body: string, commitId: string) =>
  gh<GhReview>(t, `/repos/${repo}/pulls/${n}/reviews`, {
    method: "POST",
    body: JSON.stringify({ event, body: body || undefined, commit_id: commitId }),
  });

export interface Probe { path: string; status: number; headers: Record<string, string>; body: unknown }

/** Llamada cruda para el diagnóstico: devuelve estado, cabeceras relevantes y cuerpo, sin lanzar. */
export async function probe(t: string, path: string): Promise<Probe> {
  try {
    const res = await fetch(API + path, {
      headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    const keep = ["x-accepted-github-permissions", "x-oauth-scopes", "github-authentication-token-expiration", "x-ratelimit-remaining"];
    const headers: Record<string, string> = {};
    for (const k of keep) { const v = res.headers.get(k); if (v) headers[k] = v; }
    let body: unknown = null;
    try { body = await res.json(); } catch { /* sin cuerpo */ }
    return { path, status: res.status, headers, body };
  } catch (e) {
    return { path, status: 0, headers: {}, body: (e as Error).message };
  }
}

/**
 * Prueba (sin efectos) el permiso de escritura en Pull requests del repo. Devuelve el estado HTTP.
 * Envía una review con un `event` inválido: GitHub comprueba el permiso antes de validar, así que
 * un token sin acceso concedido recibe 401/403 y uno con acceso recibe 404/422. Nunca crea nada.
 */
export async function probeReviewStatus(t: string, repo: string): Promise<number> {
  try {
    const res = await fetch(`${API}/repos/${repo}/pulls/1/reviews`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ event: "__PROBE__" }),
    });
    return res.status;
  } catch {
    return 0;
  }
}

/** true = el token tiene permiso, false = no lo tiene, null = no concluyente. */
export const accessFromStatus = (status: number): boolean | null =>
  status === 401 || status === 403 ? false : status === 404 || status === 422 ? true : null;

export const probeReviewAccess = async (t: string, repo: string): Promise<boolean | null> =>
  accessFromStatus(await probeReviewStatus(t, repo));
