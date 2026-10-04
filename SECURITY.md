# Security Policy

Routine Chat handles sensitive credentials: Claude Code routine tokens and GitHub tokens. We take security reports seriously.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report them privately through GitHub's [private vulnerability reporting](https://github.com/rodrireddev/github-routine-api/security/advisories/new). Include:

- a description of the issue and its impact;
- steps to reproduce (a proof of concept if possible);
- affected version / commit.

You can expect an initial response within a few days.

## Security model (summary)

- The local server binds to `127.0.0.1` and only forwards routine calls to `api.anthropic.com`.
- GitHub requests go directly from the client to `api.github.com`.
- Local data (conversations, trigger IDs, tokens) is stored in browser/Electron storage. It can optionally be encrypted with a passphrase (PBKDF2-SHA256, 600k iterations, plus AES-256-GCM).
- Encryption protects data at rest only. While the app is unlocked, tokens are in memory.
- Content coming from GitHub or the API is rendered as text, never as HTML.

## Recommendations for users

- Prefer **fine-grained** GitHub tokens limited to the repositories you review.
- If you use a classic token, give it a **short expiration**.
- Enable **encryption** (⚙ → Security) on shared machines.
