import type { BotSettingsService, CommandInput } from "../../services/bot-settings.js";
import { ValidationError } from "../../services/bot-settings.js";
import type { WhatsAppGateway } from "../../infrastructure/whatsapp-gateway.js";
import type { Router } from "../router.js";
import { HttpError, readJson, sendJson } from "../http-utils.js";

/** WhatsApp connection (QR linking) and the bot's commands. */
export function whatsappRoutes(router: Router, whatsapp: WhatsAppGateway, settings: BotSettingsService): void {
  router.on("GET", "/api/whatsapp/status", (_req, res) => sendJson(res, 200, whatsapp.state));

  // Starts the connection in the background: linking waits for the QR scan, which can take minutes.
  // The UI polls /api/whatsapp/status to show the QR code and the progress.
  router.on("POST", "/api/whatsapp/connect", (_req, res) => {
    if (whatsapp.state.status === "disabled") throw new HttpError(409, "WhatsApp is disabled on this server (WHATSAPP_ENABLED=false)");
    void whatsapp.connect().catch((e) => console.error("WhatsApp:", e));
    sendJson(res, 202, { ...whatsapp.state, status: "connecting" });
  });

  router.on("POST", "/api/whatsapp/logout", async (_req, res) => {
    await whatsapp.logout();
    sendJson(res, 200, whatsapp.state);
  });

  router.on("GET", "/api/bot/settings", (_req, res) => sendJson(res, 200, { commands: settings.publicCommands() }));

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

}
