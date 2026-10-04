/** Fires Claude Code routines through the Anthropic API. */

export interface RoutineResult {
  ok: boolean;
  status: number;
  data: { claude_code_session_id?: string; claude_code_session_url?: string; error?: { message?: string } } & Record<string, unknown>;
}

const TRIGGER_ID_RE = /^[\w-]{1,128}$/;
export const MAX_ROUTINE_TEXT = 20_000;

export class RoutineService {
  readonly #fetch: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.#fetch = fetchImpl;
  }

  static isValidTriggerId(triggerId: string): boolean {
    return TRIGGER_ID_RE.test(triggerId);
  }

  async fire(triggerId: string, token: string, text: string): Promise<RoutineResult> {
    if (!RoutineService.isValidTriggerId(triggerId)) throw new Error("Invalid trigger ID");
    if (text.length > MAX_ROUTINE_TEXT) throw new Error("Message too long");
    const res = await this.#fetch(`https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(triggerId)}/fire`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await res.text();
    let data: RoutineResult["data"];
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
    return { ok: res.ok, status: res.status, data };
  }
}
