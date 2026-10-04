import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { DEFAULT_COMMANDS, type Command } from "../../shared/commands.js";
import type { GhPull, OpenPull } from "../../shared/github-api.js";
import { CommandBot } from "../bot/command-bot.js";
import type { PullRequestProvider } from "../bot/ports.js";

const CHAT = "me@s.whatsapp.net";

const pull = (over: Partial<GhPull> = {}): GhPull => ({
  number: 16, title: "Fix login", body: "Details", state: "open", draft: false,
  html_url: "https://github.com/me/game/pull/16", user: { login: "alice" },
  head: { sha: "abc123", ref: "fix/login" }, base: { ref: "main" }, created_at: "2026-10-01T00:00:00Z",
  additions: 3, deletions: 1, changed_files: 1, ...over,
});

let sent: string[];
let approved: string[];
let fired: { triggerId: string; text: string }[];
let open: OpenPull[];
let current: GhPull;
let commands: Command[];
let now: number;
let bot: CommandBot;

const provider: PullRequestProvider = {
  login: async () => "me",
  listOpen: async () => open,
  get: async () => ({ pull: current, files: [{ filename: "a.ts", status: "modified", additions: 3, deletions: 1 }] }),
  approve: async (repo, number, sha) => void approved.push(`${repo}#${number}@${sha}`),
};

beforeEach(() => {
  sent = []; approved = []; fired = []; now = 0;
  open = [{ repo: "me/game", number: 16, title: "Fix login", draft: false, author: "alice", updatedAt: "2026-10-01" }];
  current = pull();
  commands = structuredClone(DEFAULT_COMMANDS);
  bot = new CommandBot({
    chat: { send: async (_chat, text) => void sent.push(text) },
    commands: () => commands,
    pulls: () => provider,
    routines: { fire: async (triggerId, _token, text) => {
      fired.push({ triggerId, text });
      return { ok: true, status: 200, data: { claude_code_session_url: "https://claude.ai/code/s1" } };
    } },
    now: () => now,
  });
});

const say = (text: string) => bot.handle({ chatId: CHAT, text });

test("ignores plain notes and lists commands on /help", async () => {
  await say("buy milk");
  assert.equal(sent.length, 0);
  await say("/help");
  assert.match(sent[0], /\/prs/);
  assert.doesNotMatch(sent[0], /\/routine/, "disabled commands are not listed");
});

test("/prs lists open PRs and /pr shows one", async () => {
  await say("/prs");
  assert.match(sent[0], /\*#16\* · game/);
  await say("/pr#16");
  assert.match(sent[1], /\*PR #16\* · me\/game/);
  assert.match(sent[1], /a\.ts \(\+3 −1\)/);
});

test("ambiguous and unknown PR numbers ask for the repo", async () => {
  open.push({ repo: "me/web", number: 16, title: "Other", draft: false, author: "bob", updatedAt: "2026-10-01" });
  await say("/pr 16");
  assert.match(sent[0], /Several open PRs are #16/);
  await say("/pr 99");
  assert.match(sent[1], /can't find/);
});

test("/approve asks for confirmation and approves on yes, pinned to the commit", async () => {
  await say("/approve 16");
  assert.match(sent[0], /Approve PR #16/);
  assert.equal(approved.length, 0);
  await say("Yes");
  assert.deepEqual(approved, ["me/game#16@abc123"]);
  assert.match(sent[1], /Approved/);
});

test("/approve is cancelled by no, by any other answer, and after expiry", async () => {
  await say("/approve 16");
  await say("no");
  await say("/approve 16");
  await say("/prs");
  await say("/approve 16");
  now += 3 * 60_000;
  await say("yes");
  assert.equal(approved.length, 0);
  assert.match(sent[1], /cancelled/);
  assert.match(sent[3], /cancelled/);
  assert.match(sent[5], /expired/);
});

test("refuses to approve your own PR", async () => {
  current = pull({ user: { login: "me" } });
  await say("/approve 16");
  assert.match(sent[0], /own pull request/);
});

test("routine commands need configuration and pass the rest of the message", async () => {
  const routine = commands.find((c) => c.action === "run_routine")!;
  routine.enabled = true;
  await say("/routine fix the bug");
  assert.match(sent[0], /no routine configured/);
  routine.routine = { triggerId: "trig_1", token: "secret" };
  await say("/routine create a branch from main and fix the bug");
  assert.deepEqual(fired, [{ triggerId: "trig_1", text: "create a branch from main and fix the bug" }]);
  assert.match(sent[1], /Routine started[\s\S]*claude\.ai\/code\/s1/);
});

test("unknown and disabled commands get a helpful reply", async () => {
  await say("/nope");
  assert.match(sent[0], /Unknown command/);
  await say("/routine x");
  assert.match(sent[1], /disabled/);
});
