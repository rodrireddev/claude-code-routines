/**
 * Ports the command bot depends on. Infrastructure (WhatsApp, GitHub, Anthropic) implements them,
 * which keeps the bot's logic independent and testable with in-memory fakes.
 */
import type { GhFile, GhPull, OpenPull } from "../../shared/github-api.js";
import type { RoutineResult } from "../services/routine-service.js";

/** A text message the user sent to their own chat. */
export interface IncomingMessage {
  chatId: string;
  text: string;
}

export interface ChatGateway {
  send(chatId: string, text: string): Promise<void>;
}

export interface PullRequestProvider {
  /** Login of the GitHub user behind the configured token. */
  login(): Promise<string>;
  listOpen(): Promise<OpenPull[]>;
  get(repo: string, number: number): Promise<{ pull: GhPull; files: GhFile[] }>;
  approve(repo: string, number: number, commitId: string): Promise<void>;
}

export interface RoutineRunner {
  fire(triggerId: string, token: string, text: string): Promise<RoutineResult>;
}
