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

- **Local mode** (default): the server binds to `127.0.0.1`, with no login.
- **Server mode** (any other `HOST`): requires `ADMIN_PASSWORD` and `APP_SECRET`, and adds:
  - **Sessions:** server-side, in `HttpOnly`, `SameSite=Strict` cookies (`Secure` over HTTPS).
  - **Login:** rate-limited, with a constant-time password check.
- **Every API write:** must be same-origin JSON (CSRF protection), is rate-limited and has a size limit.
- **Every response:** carries a strict CSP (no inline scripts), anti-framing, `nosniff` and `no-referrer` headers, plus HSTS over HTTPS.
- **Server-side secrets:** the bot's GitHub token and routine tokens are encrypted with AES-256-GCM, using a key derived from `APP_SECRET`. They are never returned to the browser.
- **Browser-side data:** conversations, trigger IDs and tokens stay in browser/Electron storage. They can be encrypted with a passphrase (PBKDF2-SHA256, 600k iterations, plus AES-256-GCM).
- **WhatsApp bot:**
  - It only acts on messages the account owner writes in their own chat.
  - Approving a PR always needs an explicit `yes` within 2 minutes, and the approval is pinned to the commit that was shown.
  - The WhatsApp Web session is stored in `DATA_DIR/whatsapp-session` (`0700`). Anyone with that folder can use the linked account.
- **Untrusted content:** content coming from GitHub or the API is rendered as text, never as HTML.

## Recommendations for users

- Prefer **fine-grained** GitHub tokens limited to the repositories you review.
- If you use a classic token, give it a **short expiration**.
- Enable **encryption** (⚙ → Security) on shared machines.
- On a server, always use HTTPS (reverse proxy + `TRUST_PROXY=true`), a long `ADMIN_PASSWORD`, and back up `DATA_DIR` securely.
- Unlink WhatsApp (WhatsApp → Unlink, or from your phone) when you no longer use the bot.
