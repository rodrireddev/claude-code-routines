import { DEFAULT_ITERATIONS, decrypt, deriveKey, encrypt, newSalt, type Vault } from "./crypto.js";
import type { Conversation, Message } from "./types.js";

const KEY = "routine-chat.conversations.v1";
const VAULT_KEY = "routine-chat.vault.v1";
const ACTIVE_KEY = "routine-chat.active.v1";

/** Lo que se guarda en disco (en claro o dentro del vault cifrado). */
interface Payload {
  conversations: Conversation[];
  githubToken: string;
}

/** Acepta el formato antiguo (solo un array de conversaciones) y el actual. */
function parsePayload(raw: unknown): Payload {
  if (Array.isArray(raw)) return { conversations: raw as Conversation[], githubToken: "" };
  const o = (raw ?? {}) as Partial<Payload>;
  return { conversations: o.conversations ?? [], githubToken: o.githubToken ?? "" };
}

export type ChangeKind = "list" | "active" | "messages" | "meta";

const uid = (): string => crypto.randomUUID();

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
}

function remove(...keys: string[]): void {
  try { for (const k of keys) localStorage.removeItem(k); } catch { /* ignorar */ }
}

/**
 * Historial de conversaciones guardado localmente (localStorage).
 * Opcionalmente cifrado con una contraseña: entonces en disco solo existe el "vault" cifrado
 * y los datos en claro viven únicamente en memoria mientras la app está desbloqueada.
 */
class Store extends EventTarget {
  conversations: Conversation[] = [];
  /** Fine-grained PAT de GitHub (para revisar PRs). Se guarda igual que el resto de datos. */
  githubToken = "";
  activeId = "";
  /** true si hay datos cifrados en disco. */
  encrypted: boolean;
  /** true si hay un vault y aún no se ha introducido la contraseña. */
  locked: boolean;
  #key: CryptoKey | null = null;
  #salt = "";
  #iter = 0;
  #writes: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this.encrypted = read<Vault | null>(VAULT_KEY, null) !== null;
    this.locked = this.encrypted;
    if (!this.encrypted) {
      const p = parsePayload(read<unknown>(KEY, []));
      this.githubToken = p.githubToken;
      this.#adopt(p.conversations, true);
    }
  }

  #blank(): Conversation {
    return { id: uid(), title: "", triggerId: "", token: "", messages: [], updatedAt: Date.now() };
  }

  /** Toma las conversaciones cargadas (en claro o descifradas). */
  #adopt(list: Conversation[], migrateLegacy: boolean): void {
    // Un "pending" guardado significa que la app se cerró antes de recibir respuesta.
    for (const c of list) {
      for (const m of c.messages) {
        if (m.variant === "pending") {
          m.variant = "error";
          m.text = "Interrumpido: no se recibió respuesta.";
        }
      }
    }
    if (list.length === 0) {
      const first = this.#blank();
      if (migrateLegacy) {
        // Migra la configuración de la versión anterior (una sola conversación).
        try {
          first.triggerId = localStorage.getItem("triggerId") ?? "";
          first.token = localStorage.getItem("token") ?? "";
        } catch { /* ignorar */ }
      }
      list = [first];
    }
    this.conversations = list;
    const saved = read<string>(ACTIVE_KEY, "");
    this.activeId = list.some((c) => c.id === saved) ? saved : list[0].id;
    this.#persist();
  }

  // ---- Persistencia / cifrado ------------------------------------------------

  #persist(): void {
    write(ACTIVE_KEY, this.activeId);
    if (this.locked) return;
    const payload: Payload = { conversations: this.conversations, githubToken: this.githubToken };
    const json = JSON.stringify(payload);
    if (!this.#key) {
      write(KEY, payload);
      return;
    }
    const key = this.#key;
    const salt = this.#salt;
    const iter = this.#iter;
    // Las escrituras cifradas se encadenan para que la última siempre gane.
    this.#writes = this.#writes
      .then(async () => write(VAULT_KEY, await encrypt(key, salt, json, iter)))
      .catch(() => undefined);
  }

  /** Descifra el vault con la contraseña. Lanza si es incorrecta. */
  async unlock(passphrase: string): Promise<void> {
    const vault = read<Vault | null>(VAULT_KEY, null);
    if (!vault) throw new Error("No hay datos cifrados");
    const key = await deriveKey(passphrase, vault.salt, vault.iter);
    let payload: Payload;
    try {
      payload = parsePayload(JSON.parse(await decrypt(key, vault)));
    } catch {
      throw new Error("Contraseña incorrecta");
    }
    this.#key = key;
    this.#salt = vault.salt;
    this.#iter = vault.iter;
    this.locked = false;
    this.githubToken = payload.githubToken;
    this.#adopt(payload.conversations, false);
  }

  /** Activa el cifrado: guarda el vault y elimina todo dato en claro. */
  async enableEncryption(passphrase: string): Promise<void> {
    this.#salt = newSalt();
    this.#iter = DEFAULT_ITERATIONS;
    this.#key = await deriveKey(passphrase, this.#salt, this.#iter);
    this.encrypted = true;
    this.#persist();
    await this.#writes;
    remove(KEY, "triggerId", "token");
    this.dispatchEvent(new Event("security"));
  }

  /** Quita el cifrado: vuelve a guardar en claro. */
  async disableEncryption(): Promise<void> {
    await this.#writes;
    this.#key = null;
    this.encrypted = false;
    this.#persist();
    remove(VAULT_KEY);
    this.dispatchEvent(new Event("security"));
  }

  /** Borra los datos en claro de memoria y vuelve a pedir la contraseña. */
  async lock(): Promise<void> {
    if (!this.encrypted) return;
    await this.#writes;
    this.#key = null;
    this.conversations = [];
    this.githubToken = "";
    this.locked = true;
    this.dispatchEvent(new Event("lock"));
  }

  setGithubToken(token: string): void {
    this.githubToken = token.trim();
    this.#persist();
    this.dispatchEvent(new Event("github"));
  }

  /** Olvidé la contraseña: borra todo (datos cifrados incluidos) y recarga. */
  reset(): void {
    remove(KEY, VAULT_KEY, ACTIVE_KEY, "triggerId", "token");
    location.reload();
  }

  #emit(kind: ChangeKind): void {
    this.#persist();
    this.dispatchEvent(new CustomEvent<ChangeKind>("change", { detail: kind }));
  }

  get active(): Conversation {
    return this.conversations.find((c) => c.id === this.activeId)!;
  }

  get(id: string): Conversation | undefined {
    return this.conversations.find((c) => c.id === id);
  }

  create(): Conversation {
    const c = this.#blank();
    // Hereda la configuración de la conversación activa para no reescribirla.
    c.triggerId = this.active.triggerId;
    c.token = this.active.token;
    this.conversations.unshift(c);
    this.activeId = c.id;
    this.#emit("list");
    this.dispatchEvent(new CustomEvent<ChangeKind>("change", { detail: "active" }));
    return c;
  }

  select(id: string): void {
    if (id === this.activeId || !this.get(id)) return;
    this.activeId = id;
    this.#emit("active");
  }

  remove(id: string): void {
    this.conversations = this.conversations.filter((c) => c.id !== id);
    if (this.conversations.length === 0) this.conversations.push(this.#blank());
    if (!this.get(this.activeId)) this.activeId = this.conversations[0].id;
    this.#emit("list");
    this.dispatchEvent(new CustomEvent<ChangeKind>("change", { detail: "active" }));
  }

  /** Edita nombre / trigger / token. No re-renderiza la conversación (se está escribiendo en ella). */
  updateMeta(id: string, patch: Partial<Pick<Conversation, "title" | "triggerId" | "token">>): void {
    const c = this.get(id);
    if (!c) return;
    Object.assign(c, patch);
    this.#emit("meta");
  }

  addMessage(id: string, msg: Omit<Message, "id" | "at">): Message {
    const c = this.get(id)!;
    const m: Message = { ...msg, id: uid(), at: Date.now() };
    c.messages.push(m);
    c.updatedAt = m.at;
    if (!c.title && m.role === "user") c.title = m.text.slice(0, 40);
    this.#emit("messages");
    return m;
  }

  updateMessage(id: string, msgId: string, patch: Partial<Message>): void {
    const m = this.get(id)?.messages.find((x) => x.id === msgId);
    if (!m) return;
    if (!("variant" in patch)) delete m.variant;
    Object.assign(m, patch);
    this.#emit("messages");
  }
}

export const store = new Store();
