import * as gh from "../../../shared/github-api.js";
import type { BotSettingsService } from "../../services/bot-settings.js";
import type { Router } from "../router.js";
import { HttpError, readJson, sendJson } from "../http-utils.js";

/**
 * The single GitHub token of the app, stored encrypted on the server. The WhatsApp bot uses it
 * directly; the Pull requests view fetches it after login (the API is protected by the session).
 */
export function githubRoutes(router: Router, settings: BotSettingsService): void {
  router.on("GET", "/api/github/token", async (_req, res) => {
    const token = settings.get().githubToken;
    const login = token ? await gh.getUser(token).then((u) => u.login).catch(() => null) : null;
    sendJson(res, 200, { token, login });
  });

  /** Saves the token after checking it with GitHub. An empty token removes it. */
  router.on("PUT", "/api/github/token", async (req, res) => {
    const { token } = await readJson<{ token?: unknown }>(req);
    const value = typeof token === "string" ? token.trim() : "";
    if (!value) {
      settings.setGithubToken("");
      return sendJson(res, 200, { token: "", login: null });
    }
    let login: string;
    try {
      login = (await gh.getUser(value)).login;
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    settings.setGithubToken(value);
    sendJson(res, 200, { token: value, login });
  });
}
