export interface FireData {
  claude_code_session_id?: string;
  claude_code_session_url?: string;
  error?: { message?: string };
  raw?: string;
}

export interface FireResponse {
  ok?: boolean;
  status?: number;
  data?: FireData;
  error?: string;
}

/** Subconjunto de la API de los elementos de Shoelace que usamos. */
export interface SlInput extends HTMLElement { value: string }
export interface SlTextarea extends HTMLElement { value: string }
export interface SlButton extends HTMLElement { disabled: boolean; loading: boolean }
export interface SlDrawer extends HTMLElement { show(): void; hide(): void }

export interface Message {
  id: string;
  role: "user" | "bot";
  text: string;
  variant?: "pending" | "error";
  sessionId?: string;
  sessionUrl?: string;
  at: number;
}

export interface Conversation {
  id: string;
  title: string;
  triggerId: string;
  token: string;
  messages: Message[];
  updatedAt: number;
}
