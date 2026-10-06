import * as gh from "../../shared/github-api.js";
import type { MergeMethod } from "../../shared/github-api.js";
import type { PullRequestProvider } from "../bot/ports.js";

/** PullRequestProvider backed by the GitHub REST API and the token saved in the bot settings. */
export class GitHubPullRequests implements PullRequestProvider {
  readonly #token: string;

  constructor(token: string) {
    this.#token = token;
  }

  async login(): Promise<string> {
    return (await gh.getUser(this.#token)).login;
  }

  /** Same scope as the UI's "All my open PRs": the user's repos, their organizations, involvement and review requests. */
  async listOpen() {
    const login = await this.login();
    const orgs = await gh.listOrgs(this.#token).catch(() => [] as string[]);
    return gh.searchOpenPulls(this.#token, [login, ...orgs], login);
  }

  async get(repo: string, number: number) {
    const [pull, files] = await Promise.all([gh.getPull(this.#token, repo, number), gh.listFiles(this.#token, repo, number)]);
    return { pull, files };
  }

  async approve(repo: string, number: number, commitId: string): Promise<void> {
    await gh.submitReview(this.#token, repo, number, "APPROVE", "", commitId);
  }

  async merge(repo: string, number: number, commitId: string, method: MergeMethod): Promise<void> {
    await gh.mergePull(this.#token, repo, number, method, commitId);
  }
}
