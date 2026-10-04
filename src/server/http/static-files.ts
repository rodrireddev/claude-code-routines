import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** Serves files from a set of mount points ("/vendor/shoelace" → node_modules/…), safe against path traversal. */
export class StaticFiles {
  readonly #mounts: { prefix: string; dir: string }[];

  constructor(mounts: { prefix: string; dir: string }[]) {
    // Longest prefix first so "/vendor/shoelace" wins over "/".
    this.#mounts = [...mounts].sort((a, b) => b.prefix.length - a.prefix.length);
  }

  async serve(url: string, res: ServerResponse): Promise<void> {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(url, "http://local").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (pathname === "/") pathname = "/index.html";
    const mount = this.#mounts.find((m) => pathname === m.prefix || pathname.startsWith(m.prefix === "/" ? "/" : `${m.prefix}/`));
    if (!mount) {
      res.writeHead(404).end("Not found");
      return;
    }
    const relative = mount.prefix === "/" ? pathname : pathname.slice(mount.prefix.length);
    const file = normalize(join(mount.dir, relative));
    if (!file.startsWith(mount.dir.endsWith(sep) ? mount.dir : mount.dir + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const content = await readFile(file);
      res.writeHead(200, {
        "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
        "Cache-Control": extname(file) === ".html" ? "no-cache" : "public, max-age=300",
      });
      res.end(content);
    } catch {
      res.writeHead(404).end("Not found");
    }
  }
}
