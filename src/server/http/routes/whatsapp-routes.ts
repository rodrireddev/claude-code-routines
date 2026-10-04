import * as gh from "../../../shared/github-api.js";
import type { BotSettingsService, CommandInput } from "../../services/bot-settings.js";
import { ValidationError } from "../../services/bot-settings.js";
import type { WhatsAppGateway } from "../../infrastructure/whatsapp-gateway.js";
import type { Router } from "../router.js";
import { HttpError, readJson, sendJson } from "../http-utils.js";

/** WhatsApp connection (QR linking) and bot settings (commands, GitHub token). */
export function whatsappRoutes(router: Router, whatsapp: WhatsAppGateway, settings: BotSettingsService): void {
  router.on("GET", "/api/whatsapp/status", (_req, res) => sendJson(res, 200, whatsapp.state));

  router.on("POST", "/api/whatsapp/connect", async (_req, res) => {
    if (whatsapp.state.status === "disabled") throw new HttpError(409, "WhatsApp is disabled on this server (WHATSAPP_ENABLED=false)");
    await whatsapp.connect();
    sendJson(res, 200, whatsapp.state);
  });

  router.on("POST", "/api/whatsapp/logout", async (_req, res) => {
    await whatsapp.logout();
    sendJson(res, 200, whatsapp.state);
  });

  router.on("GET", "/api/bot/settings", async (_req, res) => {
    const token = settings.get().githubToken;
    let login: string | null = null;
    if (token) login = await gh.getUser(token).then((u) => u.login).catch(() => null);
    sendJson(res, 200, { commands: settings.publicCommands(), github: { configured: !!token, login } });
  });

  router.on("PUT", "/api/bot/commands", async (req, res) => {
    const { commands } = await readJson<{ commands?: CommandInput[] }>(req);
    try {
      settings.setCommands(commands ?? []);
    } catch (e) {
      if (e instanceof ValidationError) throw new HttpError(400, e.message);
      throw e;
    }
    sendJson(res, 200, { commands: settings.publicCommands() });
  });

  router.on("POST", "/api/bot/commands/reset", (_req, res) => {
    settings.resetCommands();
    sendJson(res, 200, { commands: settings.publicCommands() });
  });

  /** Saves the GitHub token used by the bot after checking it with GitHub. An empty token removes it. */
  router.on("PUT", "/api/bot/github-token", async (req, res) => {
    const { token } = await readJson<{ token?: unknown }>(req);
    const value = typeof token === "string" ? token.trim() : "";
    if (!value) {
      settings.setGithubToken("");
      return sendJson(res, 200, { configured: false, login: null });
    }
    let login: string;
    try {
      login = (await gh.getUser(value)).login;
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    settings.setGithubToken(value);
    sendJson(res, 200, { configured: true, login });
  });
}
