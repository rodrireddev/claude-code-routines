/**
 * GitHub access for the UI: the shared REST client plus UI-specific helpers.
 * Error messages are rendered with the UI translations.
 */
import { t } from "../core/i18n.js";
import * as api from "../../shared/github-api.js";
import type { GhRepo } from "../../shared/github-api.js";

export * from "../../shared/github-api.js";

api.setErrorFormatter((e) => {
  if (e.kind === "auth") return t("gh.invalidToken");
  if (e.kind === "rate_limit") return t("gh.rateLimit", { mins: Math.ceil(e.retryAfter / 60) });
  if (e.kind === "no_access") return e.raw + t("gh.noAccessHint");
  return e.raw;
});

export interface RepoDiscovery { repos: GhRepo[]; warnings: string[]; orgs: string[] }

/**
 * Collects every repo we can find: /user/repos, each of the user's organizations, owners added by
 * hand, and repos revealed by the open-PR search. Partial failures are returned as warnings.
 */
export async function discoverRepos(token: string, extraOwners: string[], login = ""): Promise<RepoDiscovery> {
  const map = new Map<string, GhRepo>();
  const warnings: string[] = [];
  const add = (list: GhRepo[]): void => list.forEach((r) => map.set(r.full_name, r));

  add(await api.listRepos(token));

  let orgs: string[] = [];
  try {
    orgs = await api.listOrgs(token);
  } catch (e) {
    warnings.push(t("gh.orgsFail", { msg: (e as Error).message }));
  }
  const owners = [...new Set([...orgs, ...extraOwners])];
  const results = await Promise.allSettled(owners.map((o) => api.listOwnerRepos(token, o)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") add(r.value);
    else warnings.push(t("gh.ownerFail", { owner: owners[i], msg: (r.reason as Error).message }));
  });

  // The PR search honours the token's access, so it also reveals private (or organization) repos
  // that /user/repos does not list.
  try {
    const known = new Set(map.keys());
    const names = await api.searchPullRepos(token, [login, ...extraOwners, ...orgs], login);
    const missing = names.filter((n) => !known.has(n)).slice(0, 100);
    const fetched = await Promise.allSettled(missing.map((n) => api.getRepo(token, n)));
    fetched.forEach((r) => { if (r.status === "fulfilled") map.set(r.value.full_name, r.value); });
  } catch (e) {
    warnings.push(t("gh.searchFail", { msg: (e as Error).message }));
  }
  return { repos: [...map.values()], warnings, orgs };
}
