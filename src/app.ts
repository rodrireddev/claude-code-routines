import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const TRIGGER_ID = process.env.ROUTINE_TRIGGER_ID;
const TOKEN = process.env.ROUTINE_TOKEN;
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const SHOELACE_DIR = fileURLToPath(
  new URL("../node_modules/@shoelace-style/shoelace/cdn", import.meta.url),
);
const SHOELACE_PREFIX = "/vendor/shoelace";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
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
    if (size > 1_000_000) throw new Error("Body too large");
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
    return sendJson(res, 400, { error: "Invalid JSON", code: "invalid_json" });
  }
  if (typeof text !== "string" || !text.trim()) {
    return sendJson(res, 400, { error: "The 'text' field is required", code: "missing_text" });
  }

  if (!triggerId || !token) {
    return sendJson(res, 400, { error: "Trigger ID and token are required", code: "missing_config" });
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
    sendJson(res, 502, { error: (err as Error).message, code: "upstream" });
  }
}

async function serveStatic(url: string, res: ServerResponse): Promise<void> {
  let pathname = url === "/" ? "/index.html" : decodeURIComponent(url.split("?")[0]);
  let root = PUBLIC_DIR;
  if (pathname.startsWith(`${SHOELACE_PREFIX}/`)) {
    root = SHOELACE_DIR;
    pathname = pathname.slice(SHOELACE_PREFIX.length);
  }
  const file = normalize(join(root, pathname));
  if (!file.startsWith(root)) {
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

/** Arranca el servidor HTTP (API + estáticos) y resuelve cuando está escuchando. */
export function startServer(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/fire") return void fireRoutine(req, res);
    if (req.method === "GET") return void serveStatic(req.url ?? "/", res);
    res.writeHead(405).end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
