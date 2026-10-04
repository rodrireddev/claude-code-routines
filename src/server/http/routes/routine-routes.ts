import type { AppConfig } from "../../config.js";
import { MAX_ROUTINE_TEXT, RoutineService } from "../../services/routine-service.js";
import type { Router } from "../router.js";
import { HttpError, readJson, sendJson } from "../http-utils.js";

/** POST /api/fire — fires a routine for the chat UI (the browser sends the conversation's trigger and token). */
export function routineRoutes(router: Router, routines: RoutineService, config: AppConfig): void {
  router.on("POST", "/api/fire", async (req, res) => {
    const body = await readJson<{ text?: unknown; triggerId?: unknown; token?: unknown }>(req);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new HttpError(400, "The 'text' field is required", "missing_text");
    if (text.length > MAX_ROUTINE_TEXT) throw new HttpError(413, "Message too long");
    const triggerId = (typeof body.triggerId === "string" && body.triggerId.trim()) || config.defaultRoutine?.triggerId || "";
    const token = (typeof body.token === "string" && body.token.trim()) || config.defaultRoutine?.token || "";
    if (!triggerId || !token) throw new HttpError(400, "Trigger ID and token are required", "missing_config");
    if (!RoutineService.isValidTriggerId(triggerId)) throw new HttpError(400, "Invalid trigger ID", "missing_config");
    try {
      const result = await routines.fire(triggerId, token, text);
      sendJson(res, result.status, result);
    } catch (e) {
      throw new HttpError(502, (e as Error).message, "upstream");
    }
  });
}
