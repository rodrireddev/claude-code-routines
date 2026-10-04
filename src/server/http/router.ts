import type { IncomingMessage, ServerResponse } from "node:http";

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

/** Tiny exact-match router: "METHOD /path" → handler. */
export class Router {
  readonly #routes = new Map<string, Handler>();

  on(method: string, path: string, handler: Handler): this {
    this.#routes.set(`${method} ${path}`, handler);
    return this;
  }

  find(method: string, path: string): Handler | undefined {
    return this.#routes.get(`${method} ${path}`);
  }

  hasPath(path: string): boolean {
    return [...this.#routes.keys()].some((k) => k.endsWith(` ${path}`));
  }
}
