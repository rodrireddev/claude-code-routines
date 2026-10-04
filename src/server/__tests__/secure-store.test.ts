import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SecureStore } from "../infrastructure/secure-store.js";

test("encrypts at rest and only decrypts with the same secret", () => {
  const dir = mkdtempSync(join(tmpdir(), "rc-store-"));
  const store = new SecureStore<{ token: string }>(dir, "s", "a".repeat(32));
  store.write({ token: "ghp_SECRET" });
  const raw = readFileSync(join(dir, "s.enc.json"), "utf8");
  assert.doesNotMatch(raw, /ghp_SECRET/);
  assert.equal(statSync(join(dir, "s.enc.json")).mode & 0o777, 0o600);
  assert.deepEqual(store.read({ token: "" }), { token: "ghp_SECRET" });
  assert.throws(() => new SecureStore(dir, "s", "b".repeat(32)).read({ token: "" }), /Cannot decrypt/);
});
