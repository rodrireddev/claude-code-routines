/** Cifrado de datos en reposo: PBKDF2-SHA256 (contraseña → clave) + AES-256-GCM. */

export interface Vault {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  data: string;
}

const ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function newSalt(): string {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

/** Deriva una clave AES-GCM no exportable a partir de la contraseña. */
export async function deriveKey(passphrase: string, salt: string, iter = ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64(salt), iterations: iter },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(key: CryptoKey, salt: string, plaintext: string, iter = ITERATIONS): Promise<Vault> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { v: 1, kdf: "PBKDF2-SHA256", iter, salt, iv: b64(iv), data: b64(data) };
}

/** Lanza si la contraseña es incorrecta o los datos fueron alterados (AES-GCM autentica). */
export async function decrypt(key: CryptoKey, vault: Vault): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(vault.iv) }, key, unb64(vault.data));
  return dec.decode(plain);
}

export const DEFAULT_ITERATIONS = ITERATIONS;
