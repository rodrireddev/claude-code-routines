/**
 * WhatsApp-formatted texts sent by the bot (*bold*, _italic_, ```monospace```).
 * Bot replies start with 🤖 so they are easy to tell apart in the user's own chat.
 */
import type { Command } from "../../shared/commands.js";
import type { GhFile, GhPull, OpenPull } from "../../shared/github-api.js";

const MAX_BODY = 1500;
const MAX_FILES = 15;
const MAX_LIST = 25;

export const bot = (text: string): string => `🤖 ${text}`;

const shortRepo = (repo: string): string => repo.split("/").pop() ?? repo;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export function helpMessage(commands: Command[]): string {
  const lines = commands
    .filter((c) => c.enabled)
    .map((c) => `*${c.trigger}* — ${c.description || c.action}`);
  return bot(`*Available commands*\n\n${lines.join("\n")}`);
}

export function pullListMessage(pulls: OpenPull[], showTrigger: string | undefined): string {
  if (pulls.length === 0) return bot("No open pull requests. 🎉");
  const items = pulls.slice(0, MAX_LIST).map((p) =>
    `*#${p.number}* · ${shortRepo(p.repo)}${p.draft ? " _(draft)_" : ""}\n${truncate(p.title, 90)}\n_by ${p.author}_`);
  const more = pulls.length > MAX_LIST ? `\n\n…and ${pulls.length - MAX_LIST} more.` : "";
  const hint = showTrigger ? `\n\nSend *${showTrigger} <number>* to see one.` : "";
  return bot(`*Open pull requests (${pulls.length})*\n\n${items.join("\n\n")}${more}${hint}`);
}

export function pullDetailMessage(repo: string, pull: GhPull, files: GhFile[], approveTrigger: string | undefined): string {
  const fileLines = files.slice(0, MAX_FILES).map((f) => `• ${f.filename} (+${f.additions} −${f.deletions})`);
  if (files.length > MAX_FILES) fileLines.push(`…and ${files.length - MAX_FILES} more`);
  const body = pull.body?.trim() ? truncate(pull.body.trim(), MAX_BODY) : "_No description._";
  const parts = [
    `*PR #${pull.number}* · ${repo}${pull.draft ? " _(draft)_" : ""}`,
    `*${pull.title}*`,
    "",
    `👤 ${pull.user.login}`,
    `🌿 ${pull.head.ref} → ${pull.base.ref}`,
    `📊 +${pull.additions ?? 0} −${pull.deletions ?? 0} · ${pull.changed_files ?? files.length} file(s)`,
    "",
    "📝 *Description*",
    body,
    "",
    `📁 *Files*`,
    fileLines.join("\n") || "_None_",
    "",
    `🔗 ${pull.html_url}`,
  ];
  if (approveTrigger) parts.push("", `To approve: *${approveTrigger} ${repo}#${pull.number}*`);
  return bot(parts.join("\n"));
}

export function confirmApprovalMessage(repo: string, pull: GhPull, ttlSeconds: number): string {
  return bot([
    `⚠️ *Approve PR #${pull.number}* in ${repo}?`,
    `“${truncate(pull.title, 120)}” by ${pull.user.login}`,
    "",
    `Reply *yes* (or */yes*) to approve, anything else cancels (expires in ${Math.round(ttlSeconds / 60)} min).`,
  ].join("\n"));
}

export const messages = {
  unknownCommand: (trigger: string, help?: string) =>
    bot(`Unknown command *${trigger}*.${help ? ` Send *${help}* to see the list.` : ""}`),
  disabledCommand: (trigger: string) => bot(`*${trigger}* is disabled. Enable it in the app (WhatsApp → Commands).`),
  noGithubToken: () => bot("GitHub is not connected. Add a GitHub token in the app (WhatsApp → GitHub)."),
  usage: (example: string) => bot(`Usage: *${example}*`),
  notFound: (ref: string) => bot(`I can't find an open pull request matching *${ref}*. Use *owner/repo#number*.`),
  ambiguous: (number: number, repos: string[]) =>
    bot(`Several open PRs are #${number}:\n${repos.map((r) => `• ${r}#${number}`).join("\n")}\nSend it again with the repo, e.g. *${repos[0]}#${number}*.`),
  ownPull: () => bot("GitHub doesn't allow approving your own pull request. Ask someone else to approve it."),
  notOpen: (state: string) => bot(`This pull request is ${state}; only open PRs can be approved.`),
  approved: (repo: string, number: number, url: string) => bot(`✅ Approved *${repo}#${number}*.\n${url}`),
  cancelled: () => bot("Approval cancelled. Nothing was changed."),
  expired: () => bot("That confirmation expired. Nothing was changed; send the approve command again."),
  routineNotConfigured: (trigger: string) =>
    bot(`*${trigger}* has no routine configured. Set its Trigger ID and token in the app (WhatsApp → Commands).`),
  routineStarted: (url?: string) => bot(`🚀 Routine started.${url ? `\nSession: ${url}` : ""}`),
  routineFailed: (detail: string) => bot(`❌ The routine could not be started: ${detail}`),
  error: (detail: string) => bot(`❌ ${detail}`),
};
