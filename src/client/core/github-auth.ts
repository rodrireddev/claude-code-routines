/**
 * The app's single GitHub token. It is stored encrypted on the server and shared by the Pull
 * requests view and the WhatsApp bot; the browser only keeps it in memory.
 */
import { api } from "./api.js";

interface TokenInfo { token: string; login: string | null }

class GithubAuth extends EventTarget {
  token = "";
  login: string | null = null;

  /** Loads the token from the server. */
  async load(): Promise<void> {
    const info = await api<TokenInfo>("/api/github/token").catch(() => ({ token: "", login: null }));
    this.#set(info);
  }

  /** Validates (with GitHub) and saves the token on the server. Throws with GitHub's message if invalid. */
  async save(token: string): Promise<void> {
    this.#set(await api<TokenInfo>("/api/github/token", { method: "PUT", body: { token } }));
  }

  #set(info: TokenInfo): void {
    this.token = info.token;
    this.login = info.login;
    this.dispatchEvent(new Event("change"));
  }
}

export const githubAuth = new GithubAuth();
