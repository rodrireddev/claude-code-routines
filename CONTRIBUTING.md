# Contributing to Routine Chat

Thanks for your interest in improving Routine Chat! Bug reports, ideas and pull requests are all welcome.

## Getting started

```bash
git clone https://github.com/rodrireddev/github-routine-api.git
cd github-routine-api
npm install
npm start            # http://localhost:3000 (rebuilds on every start)
npm run electron     # desktop app
```

Requires Node.js 22.9+.

## Project layout

- `src/app.ts` – local HTTP server (static files + `/api/fire` proxy to the Anthropic API).
- `src/electron/main.ts` – Electron wrapper.
- `src/client/` – the frontend: native Web Components in TypeScript, styled with [Shoelace](https://shoelace.style). It compiles to `public/*.js` (git-ignored).

See the [README](README.md#project-structure) for a file-by-file overview.

## Guidelines

- **Keep it dependency-light.** The frontend uses plain Web Components with no framework or bundler. Please discuss before adding a dependency.
- **Type-check before pushing.** `npm run build` must pass with no errors (the project uses `strict` TypeScript).
- **Treat external data as untrusted.** Content from GitHub or the API must be rendered with `textContent` / DOM APIs, never `innerHTML`.
- **Never log or transmit tokens** anywhere other than the API they belong to (`api.anthropic.com` for routine tokens, `api.github.com` for GitHub tokens).
- **Match the surrounding code:** small focused modules, the same naming and comment style.
- **Screenshots:** if you change the UI, consider updating the images in `docs/screenshots/`.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change and run `npm run build`.
3. Check it manually with `npm start` (and `npm run electron` if relevant).
4. Open a PR describing **what** changed and **why**, with screenshots for UI changes.

## Reporting bugs

Open an issue with steps to reproduce, what you expected, and what happened instead. **Never paste tokens.** The **Diagnostics** button in the Pull requests view prints GitHub responses without the token, so its output is safe to share.

For security issues, see [SECURITY.md](SECURITY.md) instead.
