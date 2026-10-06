import { randomUUID } from "node:crypto";
import {
  DEFAULT_COMMANDS,
  normalizeTrigger,
  validateCommands,
  type Command,
  type CommandAction,
  type PublicCommand,
} from "../../shared/commands.js";
import type { SecureStore } from "../infrastructure/secure-store.js";

/** Everything the WhatsApp bot needs, persisted encrypted on the server. */
export interface BotSettings {
  githubToken: string;
  commands: Command[];
}

/** Command as received from the browser: the routine token may be blank to keep the saved one. */
export interface CommandInput {
  id?: string;
  trigger: string;
  action: CommandAction;
  description?: string;
  enabled?: boolean;
  routine?: { triggerId?: string; token?: string };
}

export class ValidationError extends Error {}

/** Owns the bot settings: loading, validation, secret masking and persistence. */
export class BotSettingsService {
  readonly #store: SecureStore<BotSettings>;
  #settings: BotSettings;

  constructor(store: SecureStore<BotSettings>) {
    this.#store = store;
    this.#settings = store.read({ githubToken: "", commands: structuredClone(DEFAULT_COMMANDS) });
    this.#addMissingMergeCommand();
  }

  /** Settings saved before /merge existed get it added (enabled; they can disable or rename it). */
  #addMissingMergeCommand(): void {
    const { commands } = this.#settings;
    if (commands.some((c) => c.action === "merge_pr")) return;
    const merge = structuredClone(DEFAULT_COMMANDS.find((c) => c.action === "merge_pr")!);
    if (commands.some((c) => c.trigger === merge.trigger)) return; // the trigger is taken by another command
    this.#settings = { ...this.#settings, commands: [...commands, merge] };
    this.#save();
  }

  get(): BotSettings {
    return this.#settings;
  }

  /** Commands without secrets, safe to send to the browser. */
  publicCommands(): PublicCommand[] {
    return this.#settings.commands.map(({ routine, ...c }) => ({
      ...c,
      ...(routine ? { routine: { triggerId: routine.triggerId, hasToken: !!routine.token } } : {}),
    }));
  }

  setGithubToken(token: string): void {
    this.#settings = { ...this.#settings, githubToken: token.trim() };
    this.#save();
  }

  /** Replaces the command list. A blank routine token keeps the token already saved for that command. */
  setCommands(input: CommandInput[]): void {
    if (!Array.isArray(input)) throw new ValidationError("commands must be an array");
    const previous = new Map(this.#settings.commands.map((c) => [c.id, c]));
    const commands: Command[] = input.map((c) => {
      const id = typeof c.id === "string" && c.id ? c.id : randomUUID();
      const command: Command = {
        id,
        trigger: normalizeTrigger(String(c.trigger ?? "")) ?? String(c.trigger ?? ""),
        action: c.action,
        description: String(c.description ?? "").slice(0, 200),
        enabled: c.enabled !== false,
      };
      if (c.action === "run_routine") {
        const token = String(c.routine?.token ?? "").trim() || previous.get(id)?.routine?.token || "";
        command.routine = { triggerId: String(c.routine?.triggerId ?? "").trim(), token };
      }
      return command;
    });
    const error = validateCommands(commands);
    if (error) throw new ValidationError(error);
    this.#settings = { ...this.#settings, commands };
    this.#save();
  }

  resetCommands(): void {
    this.#settings = { ...this.#settings, commands: structuredClone(DEFAULT_COMMANDS) };
    this.#save();
  }

  #save(): void {
    this.#store.write(this.#settings);
  }
}
