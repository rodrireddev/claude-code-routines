/**
 * Chat commands for the WhatsApp bot. Shared by the server (which executes them) and the UI
 * (which lets the user edit them).
 */

export type CommandAction =
  | "help"        // list the available commands
  | "list_prs"    // list open pull requests
  | "show_pr"     // show one pull request in detail
  | "approve_pr"  // approve a pull request (always asks for confirmation)
  | "run_routine"; // fire a Claude Code routine with the rest of the message

export const COMMAND_ACTIONS: CommandAction[] = ["help", "list_prs", "show_pr", "approve_pr", "run_routine"];

export interface RoutineTarget {
  triggerId: string;
  /** Routine token. Never sent back to the browser once saved (see `hasToken`). */
  token: string;
}

export interface Command {
  id: string;
  /** What the user types, e.g. "/prs". Lowercase, starts with "/". */
  trigger: string;
  action: CommandAction;
  description: string;
  enabled: boolean;
  /** Only for `run_routine`. */
  routine?: RoutineTarget;
}

/** A command as exposed to the browser: the routine token is replaced by a flag. */
export interface PublicCommand extends Omit<Command, "routine"> {
  routine?: { triggerId: string; hasToken: boolean };
}

/** Commands the app ships with. Kept in English on purpose; users can rename or remove them. */
export const DEFAULT_COMMANDS: Command[] = [
  { id: "help", trigger: "/help", action: "help", description: "List the available commands", enabled: true },
  { id: "prs", trigger: "/prs", action: "list_prs", description: "List your open pull requests", enabled: true },
  { id: "pr", trigger: "/pr", action: "show_pr", description: "Show a pull request: /pr 16 or /pr owner/repo#16", enabled: true },
  { id: "approve", trigger: "/approve", action: "approve_pr", description: "Approve a pull request (asks yes/no first): /approve 16", enabled: true },
  {
    id: "routine",
    trigger: "/routine",
    action: "run_routine",
    description: "Run a routine with the rest of the message: /routine fix the login bug",
    enabled: false,
    routine: { triggerId: "", token: "" },
  },
];

const TRIGGER_RE = /^\/[a-z0-9][a-z0-9_-]{0,31}$/;

/** Normalizes a trigger typed by the user ("PRS" → "/prs"). Returns null if it is not valid. */
export function normalizeTrigger(input: string): string | null {
  const value = input.trim().toLowerCase();
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return TRIGGER_RE.test(withSlash) ? withSlash : null;
}

export interface ParsedCommand {
  trigger: string;
  args: string;
}

/**
 * Splits a chat message into trigger and arguments.
 * Accepts "/pr 16", "/pr #16" and "/pr#16" (the "#" form is common on mobile keyboards).
 */
export function parseCommand(text: string): ParsedCommand | null {
  const match = /^(\/[a-z0-9][a-z0-9_-]*)(?:\s+|(?=#)|$)([\s\S]*)$/i.exec(text.trim());
  if (!match) return null;
  return { trigger: match[1].toLowerCase(), args: match[2].trim() };
}

export interface PullRef {
  /** "owner/repo" or just "repo" (resolved later against the open PRs). Empty if not given. */
  repo: string;
  number: number;
}

/** Parses "16", "#16", "repo#16", "owner/repo#16" or a GitHub PR URL. */
export function parsePullRef(input: string): PullRef | null {
  const s = input.trim();
  const url = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/i.exec(s);
  if (url) return { repo: url[1], number: Number(url[2]) };
  const ref = /^(?:([\w.-]+(?:\/[\w.-]+)?)(?:\s*#|\s+))?#?(\d+)$/.exec(s);
  if (ref) return { repo: ref[1] ?? "", number: Number(ref[2]) };
  return null;
}

/** Checks a full command list coming from the browser. Returns an error message or null. */
export function validateCommands(commands: Command[]): string | null {
  const seen = new Set<string>();
  for (const c of commands) {
    if (!COMMAND_ACTIONS.includes(c.action)) return `Unknown action: ${c.action}`;
    const trigger = normalizeTrigger(c.trigger);
    if (!trigger) return `Invalid trigger "${c.trigger}": use / followed by letters, numbers, - or _ (max 32).`;
    if (seen.has(trigger)) return `Duplicate trigger: ${trigger}`;
    seen.add(trigger);
    if (c.description.length > 200) return `Description too long for ${trigger}`;
  }
  if (commands.length > 50) return "Too many commands (max 50).";
  return null;
}
