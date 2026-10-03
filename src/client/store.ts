import type { Conversation, Message } from "./types.js";

const KEY = "routine-chat.conversations.v1";
const ACTIVE_KEY = "routine-chat.active.v1";

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

/** Historial de conversaciones guardado localmente (localStorage). */
class Store extends EventTarget {
  conversations: Conversation[];
  activeId: string;

  constructor() {
    super();
    this.conversations = read<Conversation[]>(KEY, []);
    // Un "pending" guardado significa que la app se cerró antes de recibir respuesta.
    for (const c of this.conversations) {
      for (const m of c.messages) {
        if (m.variant === "pending") {
          m.variant = "error";
          m.text = "Interrumpido: no se recibió respuesta.";
        }
      }
    }
    if (this.conversations.length === 0) {
      // Migra la configuración de la versión anterior (una sola conversación).
      const legacy = this.#blank();
      try {
        legacy.triggerId = localStorage.getItem("triggerId") ?? "";
        legacy.token = localStorage.getItem("token") ?? "";
      } catch { /* ignorar */ }
      this.conversations = [legacy];
    }
    const saved = read<string>(ACTIVE_KEY, "");
    this.activeId = this.conversations.some((c) => c.id === saved) ? saved : this.conversations[0].id;
    this.#persist();
  }

  #blank(): Conversation {
    return { id: uid(), title: "", triggerId: "", token: "", messages: [], updatedAt: Date.now() };
  }

  #persist(): void {
    write(KEY, this.conversations);
    write(ACTIVE_KEY, this.activeId);
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
