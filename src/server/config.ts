import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Project root (this file compiles to dist/server/config.js). */
export const ROOT_DIR = fileURLToPath(new URL("../../", import.meta.url));

export interface AppConfig {
  host: string;
  port: number;
  /** Where server-side state lives: encrypted settings, WhatsApp session. */
  dataDir: string;
  /** When set, the UI and API require logging in with this password. */
  adminPassword: string | null;
  /** Secret used to encrypt data at rest and sign sessions. */
  appSecret: string;
  /** Honour X-Forwarded-Proto/For when running behind a reverse proxy (HTTPS termination). */
  trustProxy: boolean;
  whatsappEnabled: boolean;
  /** Chrome/Chromium for WhatsApp Web (Puppeteer). Empty = the browser Puppeteer installed. */
  browserPath?: string;
  /** Optional routine used when a chat conversation has no trigger/token of its own. */
  defaultRoutine: { triggerId: string; token: string } | null;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export const isLoopback = (host: string): boolean => LOOPBACK.has(host);

/** Thrown when the configuration is unsafe or invalid; the process should not start. */
export class ConfigError extends Error {}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

/**
 * Local mode (default): bound to 127.0.0.1, no login, secret generated on first run.
 * Server mode (any non-loopback HOST): ADMIN_PASSWORD and APP_SECRET are mandatory.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.HOST?.trim() || "127.0.0.1";
  const port = Number(env.PORT ?? 47321);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`Invalid PORT: ${env.PORT}`);

  const dataDir = env.DATA_DIR
    ? (isAbsolute(env.DATA_DIR) ? env.DATA_DIR : resolve(env.DATA_DIR))
    : join(ROOT_DIR, "data");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const exposed = !isLoopback(host);
  const adminPassword = env.ADMIN_PASSWORD || null;
  if (exposed && !adminPassword) {
    throw new ConfigError(`HOST=${host} exposes the app to the network: set ADMIN_PASSWORD (and APP_SECRET).`);
  }
  if (adminPassword && adminPassword.length < 12) {
    throw new ConfigError("ADMIN_PASSWORD must be at least 12 characters long.");
  }

  let appSecret = env.APP_SECRET ?? "";
  if (exposed && appSecret.length < 32) {
    throw new ConfigError("APP_SECRET must be set (at least 32 characters) when the app is exposed to the network.");
  }
  if (!appSecret) appSecret = localSecret(dataDir);

  const triggerId = env.ROUTINE_TRIGGER_ID?.trim() ?? "";
  const token = env.ROUTINE_TOKEN?.trim() ?? "";

  return {
    host,
    port,
    dataDir,
    adminPassword,
    appSecret,
    trustProxy: bool(env.TRUST_PROXY, false),
    whatsappEnabled: bool(env.WHATSAPP_ENABLED, true),
    browserPath: env.PUPPETEER_EXECUTABLE_PATH || env.CHROME_PATH || undefined,
    defaultRoutine: triggerId && token ? { triggerId, token } : null,
  };
}

/** In local mode a random secret is generated once and kept in the data directory (mode 0600). */
function localSecret(dataDir: string): string {
  const file = join(dataDir, ".secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, secret, { mode: 0o600 });
  chmodSync(file, 0o600);
  return secret;
}
