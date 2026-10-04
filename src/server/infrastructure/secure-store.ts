import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface EncryptedFile {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

/**
 * A JSON document stored encrypted on disk (AES-256-GCM, key derived from APP_SECRET with scrypt).
 * Writes are atomic (temp file + rename) and the file is only readable by the current user.
 */
export class SecureStore<T> {
  readonly #file: string;
  readonly #secret: string;

  constructor(dataDir: string, name: string, secret: string) {
    this.#file = join(dataDir, `${name}.enc.json`);
    this.#secret = secret;
  }

  read(fallback: T): T {
    if (!existsSync(this.#file)) return fallback;
    const file = JSON.parse(readFileSync(this.#file, "utf8")) as EncryptedFile;
    const key = scryptSync(this.#secret, Buffer.from(file.salt, "base64"), 32);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(file.iv, "base64"));
    decipher.setAuthTag(Buffer.from(file.tag, "base64"));
    try {
      const plain = Buffer.concat([decipher.update(Buffer.from(file.data, "base64")), decipher.final()]);
      return JSON.parse(plain.toString("utf8")) as T;
    } catch {
      throw new Error(`Cannot decrypt ${this.#file}: APP_SECRET changed or the file was modified.`);
    }
  }

  write(value: T): void {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(this.#secret, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    const file: EncryptedFile = {
      v: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    };
    const tmp = `${this.#file}.tmp`;
    writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 });
    renameSync(tmp, this.#file);
  }
}
