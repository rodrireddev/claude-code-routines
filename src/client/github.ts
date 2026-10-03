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

/** Repositorios a los que el token tiene acceso. */
export const listRepos = (t: string) =>
  gh<GhRepo[]>(t, "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member");

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
