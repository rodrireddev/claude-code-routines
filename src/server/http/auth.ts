import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, isHttps } from "./http-utils.js";

const COOKIE = "rc_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();

/**
 * Password login with server-side sessions (random IDs in an HttpOnly, SameSite=Strict cookie).
 * Disabled in local mode (no ADMIN_PASSWORD): the app is then only reachable from this machine.
 */
export class SessionAuth {
  readonly #passwordHash: Buffer | null;
  readonly #sessions = new Map<string, number>();
  readonly #trustProxy: boolean;

  constructor(adminPassword: string | null, trustProxy: boolean) {
    this.#passwordHash = adminPassword ? sha256(adminPassword) : null;
    this.#trustProxy = trustProxy;
  }

  get required(): boolean {
    return this.#passwordHash !== null;
  }

  /** Constant-time password check. */
  checkPassword(password: string): boolean {
    return this.#passwordHash !== null && timingSafeEqual(sha256(password), this.#passwordHash);
  }

  isAuthenticated(req: IncomingMessage): boolean {
    if (!this.required) return true;
    const id = readCookie(req, COOKIE);
    if (!id) return false;
    const expiresAt = this.#sessions.get(id);
    if (!expiresAt || Date.now() > expiresAt) {
      this.#sessions.delete(id);
      return false;
    }
    return true;
  }

  assertAuthenticated(req: IncomingMessage): void {
    if (!this.isAuthenticated(req)) throw new HttpError(401, "Login required", "auth_required");
  }

  startSession(req: IncomingMessage, res: ServerResponse): void {
    this.#pruneExpired();
    const id = randomBytes(32).toString("base64url");
    this.#sessions.set(id, Date.now() + SESSION_TTL_MS);
    res.setHeader("Set-Cookie", this.#cookie(req, id, SESSION_TTL_MS / 1000));
  }

  endSession(req: IncomingMessage, res: ServerResponse): void {
    const id = readCookie(req, COOKIE);
    if (id) this.#sessions.delete(id);
    res.setHeader("Set-Cookie", this.#cookie(req, "", 0));
  }

  #cookie(req: IncomingMessage, value: string, maxAge: number): string {
    const secure = isHttps(req, this.#trustProxy) ? "; Secure" : "";
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
  }

  #pruneExpired(): void {
    const now = Date.now();
    for (const [id, exp] of this.#sessions) if (now > exp) this.#sessions.delete(id);
  }
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}
