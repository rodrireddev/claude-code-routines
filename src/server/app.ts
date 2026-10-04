import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { CommandBot } from "./bot/command-bot.js";
import { ROOT_DIR, type AppConfig } from "./config.js";
import { SessionAuth } from "./http/auth.js";
import { clientIp, HttpError, sendJson } from "./http/http-utils.js";
import { Router } from "./http/router.js";
import { authRoutes } from "./http/routes/auth-routes.js";
import { githubRoutes } from "./http/routes/github-routes.js";
import { routineRoutes } from "./http/routes/routine-routes.js";
import { whatsappRoutes } from "./http/routes/whatsapp-routes.js";
import { applySecurityHeaders, assertSameOrigin, RateLimiter } from "./http/security.js";
import { StaticFiles } from "./http/static-files.js";
import { GitHubPullRequests } from "./infrastructure/github-provider.js";
import { SecureStore } from "./infrastructure/secure-store.js";
import { WhatsAppGateway } from "./infrastructure/whatsapp-gateway.js";
import { BotSettingsService, type BotSettings } from "./services/bot-settings.js";
import { RoutineService } from "./services/routine-service.js";

export interface App {
  server: Server;
  whatsapp: WhatsAppGateway;
  listen(): Promise<void>;
  close(): Promise<void>;
}

/** Composition root: builds every service, wires the WhatsApp bot and the HTTP pipeline. */
export function createApp(config: AppConfig): App {
  // Services and infrastructure
  const settings = new BotSettingsService(new SecureStore<BotSettings>(config.dataDir, "bot-settings", config.appSecret));
  const routines = new RoutineService();
  const whatsapp = new WhatsAppGateway({ dataDir: config.dataDir, enabled: config.whatsappEnabled, browserPath: config.browserPath });
  const bot = new CommandBot({
    chat: whatsapp,
    commands: () => settings.get().commands,
    pulls: () => (settings.get().githubToken ? new GitHubPullRequests(settings.get().githubToken) : null),
    routines,
  });
  whatsapp.onMessage((msg) => bot.handle(msg));

  // HTTP
  const auth = new SessionAuth(config.adminPassword, config.trustProxy);
  const router = new Router();
  authRoutes(router, auth, config.trustProxy);
  routineRoutes(router, routines, config);
  whatsappRoutes(router, whatsapp, settings);
  githubRoutes(router, settings);

  const files = new StaticFiles([
    { prefix: "/", dir: join(ROOT_DIR, "public") },
    { prefix: "/vendor/shoelace", dir: join(ROOT_DIR, "node_modules/@shoelace-style/shoelace/cdn") },
  ]);
  const apiLimiter = new RateLimiter(600, 60_000);

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applySecurityHeaders(req, res, config.trustProxy);
    const method = req.method ?? "GET";
    const path = new URL(req.url ?? "/", "http://local").pathname;

    if (!path.startsWith("/api/")) {
      if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "Method not allowed");
      return files.serve(req.url ?? "/", res);
    }

    apiLimiter.hit(clientIp(req, config.trustProxy));
    assertSameOrigin(req);
    if (!path.startsWith("/api/auth/")) auth.assertAuthenticated(req);
    const handler = router.find(method, path);
    if (!handler) throw new HttpError(router.hasPath(path) ? 405 : 404, "Not found");
    await handler(req, res);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) return void res.end();
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, code: e.code });
      console.error(e);
      sendJson(res, 500, { error: "Internal server error" });
    });
  });
  // Slow-client protection
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;

  return {
    server,
    whatsapp,
    listen: () => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, () => {
        // Resume a previously linked WhatsApp session without asking for a new QR.
        if (whatsapp.hasSession()) void whatsapp.connect().catch((e) => console.error("WhatsApp:", e));
        resolve();
      });
    }),
    close: async () => {
      await whatsapp.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
