import { parseCommand, parsePullRef, type Command, type CommandAction } from "../../shared/commands.js";
import type { GhPull } from "../../shared/github-api.js";
import {
  confirmApprovalMessage,
  helpMessage,
  messages,
  pullDetailMessage,
  pullListMessage,
} from "./messages.js";
import type { ChatGateway, IncomingMessage, PullRequestProvider, RoutineRunner } from "./ports.js";

export interface CommandBotDeps {
  chat: ChatGateway;
  /** Current command list (read on every message so edits apply immediately). */
  commands: () => Command[];
  /** Null when no GitHub token is configured. */
  pulls: () => PullRequestProvider | null;
  routines: RoutineRunner;
  now?: () => number;
  confirmationTtlMs?: number;
}

interface PendingApproval {
  repo: string;
  pull: GhPull;
  expiresAt: number;
}

const YES = new Set(["yes", "y", "si", "sí", "s", "ok"]);
const NO = new Set(["no", "n", "not", "nope", "cancel"]);

/**
 * Turns chat messages into actions. Only messages starting with "/" are commands; anything else
 * is ignored (it is the user's own chat, where they may also write notes) unless an approval is
 * waiting for a yes/no answer.
 */
export class CommandBot {
  readonly #deps: CommandBotDeps;
  readonly #pending = new Map<string, PendingApproval>();
  readonly #now: () => number;
  readonly #ttl: number;

  constructor(deps: CommandBotDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
    this.#ttl = deps.confirmationTtlMs ?? 2 * 60_000;
  }

  async handle(msg: IncomingMessage): Promise<void> {
    const text = msg.text.trim();
    if (!text) return;
    try {
      if (this.#pending.has(msg.chatId)) return await this.#answerConfirmation(msg.chatId, text);
      const parsed = parseCommand(text);
      if (!parsed) return;
      const command = this.#deps.commands().find((c) => c.trigger === parsed.trigger);
      if (!command) return await this.#reply(msg.chatId, messages.unknownCommand(parsed.trigger, this.#trigger("help")));
      if (!command.enabled) return await this.#reply(msg.chatId, messages.disabledCommand(command.trigger));
      await this.#run(command, parsed.args, msg.chatId);
    } catch (e) {
      await this.#reply(msg.chatId, messages.error((e as Error).message)).catch((sendError) =>
        console.error("[bot] could not send the error reply:", sendError));
    }
  }

  async #run(command: Command, args: string, chatId: string): Promise<void> {
    switch (command.action) {
      case "help":
        return this.#reply(chatId, helpMessage(this.#deps.commands()));
      case "list_prs": {
        const pulls = await this.#requirePulls(chatId);
        if (!pulls) return;
        return this.#reply(chatId, pullListMessage(await pulls.listOpen(), this.#trigger("show_pr")));
      }
      case "show_pr": {
        const target = await this.#resolvePull(chatId, command, args);
        if (!target) return;
        const { pull, files } = await target.provider.get(target.repo, target.number);
        return this.#reply(chatId, pullDetailMessage(target.repo, pull, files, this.#trigger("approve_pr")));
      }
      case "approve_pr": {
        const target = await this.#resolvePull(chatId, command, args);
        if (!target) return;
        const { pull } = await target.provider.get(target.repo, target.number);
        if (pull.state !== "open") return this.#reply(chatId, messages.notOpen(pull.state));
        if (pull.user.login === (await target.provider.login())) return this.#reply(chatId, messages.ownPull());
        this.#pending.set(chatId, { repo: target.repo, pull, expiresAt: this.#now() + this.#ttl });
        return this.#reply(chatId, confirmApprovalMessage(target.repo, pull, this.#ttl / 1000));
      }
      case "run_routine": {
        const routine = command.routine;
        if (!routine?.triggerId || !routine.token) return this.#reply(chatId, messages.routineNotConfigured(command.trigger));
        if (!args) return this.#reply(chatId, messages.usage(`${command.trigger} <what the routine should do>`));
        const result = await this.#deps.routines.fire(routine.triggerId, routine.token, args);
        if (!result.ok) {
          return this.#reply(chatId, messages.routineFailed(result.data?.error?.message ?? `HTTP ${result.status}`));
        }
        return this.#reply(chatId, messages.routineStarted(result.data.claude_code_session_url));
      }
    }
  }

  /** Handles the yes/no answer. Any other answer cancels: approving by mistake is worse than retyping. */
  async #answerConfirmation(chatId: string, text: string): Promise<void> {
    const pending = this.#pending.get(chatId)!;
    this.#pending.delete(chatId);
    if (this.#now() > pending.expiresAt) return this.#reply(chatId, messages.expired());
    // "/yes" is accepted too: through Meta AI every answer has to be a command.
    const answer = text.toLowerCase().replace(/[.!¡/]/g, "").trim();
    if (!YES.has(answer)) return this.#reply(chatId, messages.cancelled());
    const provider = await this.#requirePulls(chatId);
    if (!provider) return;
    // Pinned to the commit shown when confirming: new pushes in between are not approved blindly.
    await provider.approve(pending.repo, pending.pull.number, pending.pull.head.sha);
    await this.#reply(chatId, messages.approved(pending.repo, pending.pull.number, pending.pull.html_url));
  }

  /** Finds the PR referenced by "16", "repo#16", "owner/repo#16" or a URL. */
  async #resolvePull(chatId: string, command: Command, args: string) {
    const provider = await this.#requirePulls(chatId);
    if (!provider) return null;
    const ref = parsePullRef(args);
    if (!ref) {
      await this.#reply(chatId, messages.usage(`${command.trigger} 16  or  ${command.trigger} owner/repo#16`));
      return null;
    }
    if (ref.repo.includes("/")) return { provider, repo: ref.repo, number: ref.number };
    const candidates = (await provider.listOpen()).filter((p) =>
      p.number === ref.number && (!ref.repo || p.repo.toLowerCase().endsWith(`/${ref.repo.toLowerCase()}`)));
    if (candidates.length === 0) {
      await this.#reply(chatId, messages.notFound(args));
      return null;
    }
    if (candidates.length > 1) {
      await this.#reply(chatId, messages.ambiguous(ref.number, candidates.map((c) => c.repo)));
      return null;
    }
    return { provider, repo: candidates[0].repo, number: ref.number };
  }

  async #requirePulls(chatId: string): Promise<PullRequestProvider | null> {
    const provider = this.#deps.pulls();
    if (!provider) await this.#reply(chatId, messages.noGithubToken());
    return provider;
  }

  /** Trigger of the first enabled command with the given action (used in hints). */
  #trigger(action: CommandAction): string | undefined {
    return this.#deps.commands().find((c) => c.action === action && c.enabled)?.trigger;
  }

  #reply(chatId: string, text: string): Promise<void> {
    return this.#deps.chat.send(chatId, text);
  }
}
