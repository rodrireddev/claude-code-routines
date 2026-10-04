import { createApp } from "./app.js";
import { ConfigError, isLoopback, loadConfig } from "./config.js";

/** CLI entry point: `npm start`. */
try {
  const config = loadConfig();
  const app = createApp(config);
  await app.listen();
  const where = isLoopback(config.host) ? `http://localhost:${config.port}` : `${config.host}:${config.port}`;
  console.log(`Routine Chat running at ${where}${config.adminPassword ? " (login required)" : " (local mode, no login)"}`);
  const shutdown = (): void => void app.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`Configuration error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
