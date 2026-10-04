import type { Router } from "../router.js";
import type { SessionAuth } from "../auth.js";
import { clientIp, HttpError, readJson, sendJson } from "../http-utils.js";
import { RateLimiter } from "../security.js";

/** Login / logout. 10 failed attempts per IP and 15 minutes, then the IP is blocked for the rest of the window. */
export function authRoutes(router: Router, auth: SessionAuth, trustProxy: boolean): void {
  const attempts = new RateLimiter(10, 15 * 60_000);

  router.on("GET", "/api/auth/status", (req, res) =>
    sendJson(res, 200, { required: auth.required, authenticated: auth.isAuthenticated(req) }));

  router.on("POST", "/api/auth/login", async (req, res) => {
    if (!auth.required) return sendJson(res, 200, { ok: true });
    const ip = clientIp(req, trustProxy);
    attempts.hit(ip);
    const { password } = await readJson<{ password?: unknown }>(req);
    if (typeof password !== "string" || !auth.checkPassword(password)) {
      throw new HttpError(401, "Wrong password", "wrong_password");
    }
    attempts.reset(ip);
    auth.startSession(req, res);
    sendJson(res, 200, { ok: true });
  });

  router.on("POST", "/api/auth/logout", (req, res) => {
    auth.endSession(req, res);
    sendJson(res, 200, { ok: true });
  });
}
