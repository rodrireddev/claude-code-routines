/** Per-browser preferences of the Pull requests view (not secret, so kept in plain localStorage). */

const PREFS_KEY = "routine-chat.repos.v1";
const REPO_KEY = "routine-chat.repo.v1";

export interface RepoPrefs {
  /** Repos ("owner/repo") or owners added by hand. */
  manual: string[];
  /** Repos chosen in "Choose repos"; null = automatic. */
  enabled: string[] | null;
}

export function readPrefs(): RepoPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<RepoPrefs>;
    return { manual: p.manual ?? [], enabled: p.enabled ?? null };
  } catch {
    return { manual: [], enabled: null };
  }
}

export function savePrefs(prefs: RepoPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

/** Last repository selected in the dropdown. */
export function lastRepo(): string {
  try { return localStorage.getItem(REPO_KEY) ?? ""; } catch { return ""; }
}

export function rememberRepo(repo: string): void {
  try { localStorage.setItem(REPO_KEY, repo); } catch { /* storage unavailable */ }
}
