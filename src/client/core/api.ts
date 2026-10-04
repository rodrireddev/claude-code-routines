/** Calls to this app's own server (/api/*). Signals "auth-required" when the session is missing or expired. */

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : {},
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (res.status === 401 && data.code === "auth_required") window.dispatchEvent(new Event("auth-required"));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText, data.code);
  return data;
}

/** Like `api`, but returns the body even for non-2xx responses (used where the UI renders upstream errors). */
export async function apiRaw<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as T & { code?: string };
  if (res.status === 401 && data.code === "auth_required") window.dispatchEvent(new Event("auth-required"));
  return data;
}

/** Whether this server requires logging in (set at startup from /api/auth/status). */
export const session = { authRequired: false };

export async function authStatus(): Promise<{ required: boolean; authenticated: boolean }> {
  const status = await api<{ required: boolean; authenticated: boolean }>("/api/auth/status");
  session.authRequired = status.required;
  return status;
}

export async function login(password: string): Promise<void> {
  await api("/api/auth/login", { method: "POST", body: { password } });
}

export async function logout(): Promise<void> {
  await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
  window.dispatchEvent(new Event("auth-required"));
}
