interface FireData {
  type?: string;
  claude_code_session_id?: string;
  claude_code_session_url?: string;
  error?: { message?: string };
  raw?: string;
}

interface FireResponse {
  ok?: boolean;
  status?: number;
  data?: FireData;
  error?: string;
}

const messages = document.getElementById("messages") as HTMLDivElement;
const form = document.getElementById("form") as HTMLFormElement;
const input = document.getElementById("input") as HTMLTextAreaElement;
const send = document.getElementById("send") as HTMLButtonElement;

function addMessage(role: "user" | "bot", text: string, cls = ""): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `msg ${role} ${cls}`.trim();
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function renderResult(el: HTMLDivElement, res: FireResponse): void {
  el.className = "msg bot";
  el.textContent = "";
  if (res.error || !res.ok) {
    el.classList.add("error");
    el.textContent =
      res.error ?? `Error ${res.status}: ${res.data?.error?.message ?? JSON.stringify(res.data)}`;
    return;
  }
  const { claude_code_session_url: url, claude_code_session_id: id } = res.data ?? {};
  el.append("Routine lanzada correctamente.");
  if (url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Ver sesión y respuesta";
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.append(a, id ? ` · ${id}` : "");
    el.append(meta);
  } else {
    const pre = document.createElement("span");
    pre.className = "meta";
    pre.textContent = JSON.stringify(res.data);
    el.append(pre);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  addMessage("user", text);
  const pending = addMessage("bot", "Ejecutando routine…", "pending");
  send.disabled = true;
  try {
    const r = await fetch("/api/fire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    renderResult(pending, (await r.json()) as FireResponse);
  } catch (err) {
    renderResult(pending, { error: `Error de red: ${(err as Error).message}` });
  } finally {
    send.disabled = false;
    input.focus();
    messages.scrollTop = messages.scrollHeight;
  }
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});
