/**
 * Minimal GitHub REST client shared by the browser UI and the server (WhatsApp bot).
 * It only depends on `fetch`, so it runs unchanged in both environments.
 */

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
  merged?: boolean;
}
export type MergeMethod = "merge" | "squash" | "rebase";
export const MERGE_METHODS: MergeMethod[] = ["merge", "squash", "rebase"];
export interface GhMergeResult { merged: boolean; sha: string; message: string }
export interface GhFile { filename: string; status: string; additions: number; deletions: number; patch?: string }
export interface GhReview { id: number; user: { login: string }; state: string; body: string; submitted_at?: string }
export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface OpenPull { repo: string; number: number; title: string; draft: boolean; author: string; updatedAt: string }

/** Why a GitHub call failed, so each caller can phrase the error in its own language. */
export type GhErrorKind = "auth" | "rate_limit" | "no_access" | "other";

export interface GhErrorInfo {
  status: number;
  kind: GhErrorKind;
  /** GitHub's own message. */
  raw: string;
  /** Seconds to wait before retrying (rate limits only). */
  retryAfter: number;
}

/** Turns an error into user-facing text. Callers can replace it (the UI uses its translations). */
export type ErrorFormatter = (info: GhErrorInfo) => string;

const englishMessages: ErrorFormatter = (e) => {
  if (e.kind === "auth") return "Invalid or expired token.";
  if (e.kind === "rate_limit") return `GitHub rate limit reached for this token. Try again in about ${Math.ceil(e.retryAfter / 60)} min.`;
  if (e.kind === "no_access") return `${e.raw} (does the token have access to that repository and Pull requests permission?)`;
  return e.raw;
};

let formatError: ErrorFormatter = englishMessages;

export function setErrorFormatter(fn: ErrorFormatter): void {
  formatError = fn;
}

export class GhError extends Error {
  readonly status: number;
  readonly kind: GhErrorKind;

  constructor(info: GhErrorInfo) {
    super(formatError(info));
    this.status = info.status;
    this.kind = info.kind;
  }
}

/**
 * Short-lived cache for GET requests. Rebuilding a view or answering repeated chat commands
 * issues the same calls; GitHub's search API only allows 30 requests per minute, so identical
 * requests within the TTL share one response (concurrent ones share the same in-flight promise).
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** Drops cached responses (used by "Refresh" and after any write). */
export function clearCache(): void {
  cache.clear();
}

function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const isGet = !init.method || init.method === "GET";
  if (!isGet) {
    clearCache();
    return request<T>(token, path, init);
  }
  const key = `${token}\n${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as Promise<T>;
  const value = request<T>(token, path, init);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key)); // never cache failures
  return value;
}

/** Seconds until GitHub lifts a rate limit, from its response headers. */
function retryAfter(res: Response): number {
  const after = Number(res.headers.get("retry-after"));
  if (after > 0) return after;
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  return reset > 0 ? Math.max(1, Math.ceil(reset - Date.now() / 1000)) : 60;
}

const headers = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { ...headers(token), ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) {
    let raw = res.statusText;
    try {
      const j = (await res.json()) as { message?: string; errors?: unknown[] };
      raw = j.message ?? raw;
      if (j.errors?.length) raw += ` ${JSON.stringify(j.errors)}`;
    } catch { /* no body */ }
    const rateLimited = (res.status === 403 || res.status === 429)
      && (res.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(raw));
    const kind: GhErrorKind = res.status === 401 ? "auth"
      : rateLimited ? "rate_limit"
      : res.status === 403 || res.status === 404 ? "no_access"
      : "other";
    throw new GhError({ status: res.status, kind, raw, retryAfter: rateLimited ? retryAfter(res) : 0 });
  }
  return (await res.json()) as T;
}

export const getUser = (t: string) => gh<{ login: string }>(t, "/user");

/**
 * Repositories GitHub returns for the token. A fine-grained token can always read public repos,
 * so this list may include public repos that were not granted to it.
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

export const listOrgs = async (t: string): Promise<string[]> =>
  (await gh<{ login: string }[]>(t, "/user/orgs?per_page=100")).map((o) => o.login);

/** Repos of an owner (organization or user) that the token can see. */
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

interface SearchItem {
  repository_url: string;
  number: number;
  title: string;
  draft?: boolean;
  user: { login: string };
  updated_at: string;
}

/** Open PRs visible to the token: in the given owners' repos, involving the user, or requesting their review. */
export async function searchOpenPulls(t: string, owners: string[], login: string): Promise<OpenPull[]> {
  const queries = [
    ...[...new Set(owners.filter(Boolean))].map((o) => `is:pr is:open user:${o}`),
    ...(login ? [`is:pr is:open involves:${login}`, `is:pr is:open review-requested:${login}`] : []),
  ];
  const found = new Map<string, OpenPull>();
  for (const q of queries) {
    for (let page = 1; page <= 3; page++) {
      const res = await gh<{ items: SearchItem[] }>(t, `/search/issues?q=${encodeURIComponent(q)}&per_page=100&page=${page}`);
      for (const it of res.items) {
        const repo = it.repository_url.replace(/^.*\/repos\//, "");
        found.set(`${repo}#${it.number}`, {
          repo, number: it.number, title: it.title, draft: !!it.draft, author: it.user.login, updatedAt: it.updated_at,
        });
      }
      if (res.items.length < 100) break;
    }
  }
  return [...found.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Repos (owner/name) with open PRs visible to the token. */
export async function searchPullRepos(t: string, owners: string[], login: string): Promise<string[]> {
  return [...new Set((await searchOpenPulls(t, owners, login)).map((p) => p.repo))];
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

/** Submits a review. `commitId` pins it to the commit that was being looked at. */
export const submitReview = (t: string, repo: string, n: number, event: ReviewEvent, body: string, commitId: string) =>
  gh<GhReview>(t, `/repos/${repo}/pulls/${n}/reviews`, {
    method: "POST",
    body: JSON.stringify({ event, body: body || undefined, commit_id: commitId }),
  });

/**
 * Merges a pull request. `commitId` is the head commit that was being looked at: GitHub refuses
 * (409) if the branch moved in between, so new pushes are never merged blindly.
 */
export function mergePull(t: string, repo: string, n: number, method: MergeMethod, commitId: string) {
  return gh<GhMergeResult>(t, `/repos/${repo}/pulls/${n}/merge`, {
    method: "PUT",
    body: JSON.stringify({ merge_method: method, sha: commitId }),
  });
}

export interface Probe { path: string; status: number; headers: Record<string, string>; body: unknown }

/** Raw call for diagnostics: returns status, relevant headers and body without throwing. */
export async function probe(t: string, path: string): Promise<Probe> {
  try {
    const res = await fetch(API + path, { headers: headers(t) });
    const keep = ["x-accepted-github-permissions", "x-oauth-scopes", "github-authentication-token-expiration", "x-ratelimit-remaining"];
    const found: Record<string, string> = {};
    for (const k of keep) { const v = res.headers.get(k); if (v) found[k] = v; }
    let body: unknown = null;
    try { body = await res.json(); } catch { /* no body */ }
    return { path, status: res.status, headers: found, body };
  } catch (e) {
    return { path, status: 0, headers: {}, body: (e as Error).message };
  }
}

/**
 * Side-effect-free check of the Pull requests write permission on a repo. Returns the HTTP status.
 * It sends a review with an invalid `event`: GitHub checks permissions before validating, so a token
 * without access gets 401/403 and one with access gets 404/422. Nothing is ever created.
 */
export async function probeReviewStatus(t: string, repo: string): Promise<number> {
  try {
    const res = await fetch(`${API}/repos/${repo}/pulls/1/reviews`, {
      method: "POST",
      headers: { ...headers(t), "Content-Type": "application/json" },
      body: JSON.stringify({ event: "__PROBE__" }),
    });
    return res.status;
  } catch {
    return 0;
  }
}

/** true = the token has the permission, false = it doesn't, null = inconclusive. */
export const accessFromStatus = (status: number): boolean | null =>
  status === 401 || status === 403 ? false : status === 404 || status === 422 ? true : null;

export const probeReviewAccess = async (t: string, repo: string): Promise<boolean | null> =>
  accessFromStatus(await probeReviewStatus(t, repo));
