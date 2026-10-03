import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 3000);
const TRIGGER_ID = process.env.ROUTINE_TRIGGER_ID;
const TOKEN = process.env.ROUTINE_TOKEN;
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error("Body demasiado grande");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fireRoutine(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let text: unknown;
  let triggerId: string | undefined = TRIGGER_ID;
  let token: string | undefined = TOKEN;
  try {
    const body = JSON.parse(await readBody(req));
    text = body.text;
    if (typeof body.triggerId === "string" && body.triggerId.trim()) triggerId = body.triggerId.trim();
    if (typeof body.token === "string" && body.token.trim()) token = body.token.trim();
  } catch {
    return sendJson(res, 400, { error: "JSON inválido" });
  }
  if (typeof text !== "string" || !text.trim()) {
    return sendJson(res, 400, { error: "El campo 'text' es obligatorio" });
  }

  if (!triggerId || !token) {
    return sendJson(res, 400, { error: "Configura el Trigger ID y el Token (⚙ Configuración)." });
  }

  try {
    const upstream = await fetch(
      `https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(triggerId)}/fire`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "experimental-cc-routine-2026-04-01",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      },
    );
    const raw = await upstream.text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
    sendJson(res, upstream.status, { ok: upstream.ok, status: upstream.status, data });
  } catch (err) {
    sendJson(res, 502, { error: `No se pudo contactar con la API: ${(err as Error).message}` });
  }
}

async function serveStatic(url: string, res: ServerResponse): Promise<void> {
  const pathname = url === "/" ? "/index.html" : decodeURIComponent(url.split("?")[0]);
  const file = normalize(join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/fire") return void fireRoutine(req, res);
  if (req.method === "GET") return void serveStatic(req.url ?? "/", res);
  res.writeHead(405).end();
}).listen(PORT, () => {
  console.log(`Routine chat en http://localhost:${PORT}`);
});
