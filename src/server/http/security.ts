import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, isHttps } from "./http-utils.js";

/**
 * Security headers for every response.
 * - CSP: scripts only from this origin (no inline scripts); GitHub API is the only external endpoint
 *   the browser talks to. Inline styles are allowed because web components style their shadow DOM.
 * - No framing (clickjacking), no MIME sniffing, no referrer leaks.
 */
export function applySecurityHeaders(req: IncomingMessage, res: ServerResponse, trustProxy: boolean): void {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' data: https://api.github.com", // data: = Shoelace's built-in icons
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isHttps(req, trustProxy)) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

/**
 * CSRF protection for state-changing API calls: they must be JSON (which a cross-site form can't
 * send without a CORS preflight) and, when the browser sends an Origin, it must be this host.
 */
export function assertSameOrigin(req: IncomingMessage): void {
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") return;
  const type = req.headers["content-type"] ?? "";
  if (!type.startsWith("application/json")) throw new HttpError(415, "Content-Type must be application/json");
  const origin = req.headers.origin;
  if (origin) {
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, "Invalid origin");
    }
    if (host !== req.headers.host) throw new HttpError(403, "Cross-origin request blocked");
  }
}

/** Fixed-window rate limiter keyed by client (e.g. IP). */
export class RateLimiter {
  readonly #hits = new Map<string, { count: number; resetAt: number }>();

  constructor(readonly limit: number, readonly windowMs: number) {}

  /** Records a hit; throws 429 when the client is over the limit. */
  hit(key: string): void {
    const now = Date.now();
    const entry = this.#hits.get(key);
    if (!entry || now > entry.resetAt) {
      this.#hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.#hits.size > 10_000) this.#prune(now);
      return;
    }
    entry.count++;
    if (entry.count > this.limit) {
      throw new HttpError(429, `Too many requests. Try again in ${Math.ceil((entry.resetAt - now) / 1000)} s.`);
    }
  }

  reset(key: string): void {
    this.#hits.delete(key);
  }

  #prune(now: number): void {
    for (const [k, v] of this.#hits) if (now > v.resetAt) this.#hits.delete(k);
  }
}
