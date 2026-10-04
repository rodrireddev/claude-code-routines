import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp, type App } from "../app.js";
import { ConfigError, loadConfig } from "../config.js";

let app: App;
let base: string;

before(async () => {
  const config = loadConfig({
    PORT: "1", DATA_DIR: mkdtempSync(join(tmpdir(), "rc-http-")),
    ADMIN_PASSWORD: "correct horse battery", WHATSAPP_ENABLED: "false",
  });
  app = createApp({ ...config, port: 0 });
  await app.listen();
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
after(() => app.close());

const json = { "Content-Type": "application/json" };

test("refuses to expose the app without a password and secret", () => {
  assert.throws(() => loadConfig({ HOST: "0.0.0.0", DATA_DIR: mkdtempSync(join(tmpdir(), "rc-c-")) }), ConfigError);
  assert.throws(() => loadConfig({ HOST: "0.0.0.0", ADMIN_PASSWORD: "x".repeat(12), DATA_DIR: mkdtempSync(join(tmpdir(), "rc-c-")) }), /APP_SECRET/);
});

test("sends security headers", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy")!, /script-src 'self'/);
  assert.equal(res.headers.get("x-frame-options"), "DENY");
});

test("API requires login; wrong password is rejected; session cookie works", async () => {
  assert.equal((await fetch(`${base}/api/whatsapp/status`)).status, 401);
  const bad = await fetch(`${base}/api/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ password: "nope" }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(`${base}/api/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse battery" }) });
  const cookie = ok.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const status = await fetch(`${base}/api/whatsapp/status`, { headers: { cookie: cookie.split(";")[0] } });
  assert.deepEqual(await status.json(), { status: "disabled" });
});

test("blocks cross-site and non-JSON writes (CSRF)", async () => {
  const form = await fetch(`${base}/api/auth/login`, { method: "POST", body: "password=x", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  assert.equal(form.status, 415);
  const cross = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { ...json, Origin: "https://evil.example" }, body: "{}" });
  assert.equal(cross.status, 403);
});

test("static files are safe against path traversal", async () => {
  const res = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.notEqual(res.status, 200);
});
