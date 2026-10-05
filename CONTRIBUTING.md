# Contributing to Routine Chat

Thanks for your interest in improving Routine Chat! Bug reports, ideas and pull requests are all welcome.

## Getting started

```bash
git clone https://github.com/rodrireddev/github-routine-api.git
cd github-routine-api
npm install
npm start            # http://localhost:47321 (rebuilds on every start)
npm run electron     # desktop app
```

Requires Node.js 22.9+.

## Project layout

- `src/shared/` – code used by both the server and the browser (command model, GitHub client).
- `src/server/` – layered server: `config` → `http` (routes, auth, security) → `bot` (use cases behind ports) → `services` / `infrastructure` (adapters).
- `src/electron/main.ts` – Electron wrapper.
- `src/client/` – the frontend: native Web Components in TypeScript, styled with [Shoelace](https://shoelace.style). It compiles to `public/js/` (git-ignored).

See the [README](README.md#project-structure) for a file-by-file overview.

## Guidelines

- **Keep it dependency-light.** The frontend uses plain Web Components with no framework or bundler. Please discuss before adding a dependency.
- **Type-check and test before pushing.** `npm run build` and `npm test` must pass (the project uses `strict` TypeScript).
- **Respect the layers.** The bot (`src/server/bot`) must not import WhatsApp, GitHub or HTTP code directly: add a port in `bot/ports.ts` and an adapter in `infrastructure/`. New logic comes with a test in `src/server/__tests__`.
- **Treat external data as untrusted.** Content from GitHub or the API must be rendered with `textContent` / DOM APIs, never `innerHTML`.
- **Never log or transmit tokens** anywhere other than the API they belong to (`api.anthropic.com` for routine tokens, `api.github.com` for GitHub tokens).
- **Match the surrounding code:** small focused modules, the same naming and comment style.
- **Translations:** UI strings live in `src/client/i18n.ts`. English is the source of truth: the build fails if another language is missing a key. To add a language, add a dictionary and an entry in `LANGUAGES`.
- **Screenshots:** if you change the UI, consider updating the images in `docs/screenshots/`.

## Dependency overrides

`package.json` pins a few transitive dependencies of WPPConnect/Puppeteer to fixed versions (`overrides`), removing deprecation warnings and known vulnerabilities:

| Package | Why |
|---|---|
| `rimraf` → 6 | v3 is deprecated and pulls `glob@7` + `inflight` (memory leak). WPPConnect only uses it in code paths this app doesn't run (ffmpeg audio conversion, Puppeteer's profile plugin; we launch the browser ourselves). |
| `basic-ftp` → 6.2.2 | Fixes a DoS advisory (only reachable through FTP proxy URLs, which we never use). |
| `sharp` → 0.35.5 | Fixes libvips/libheif advisories (WPPConnect uses it only for stickers). |
| `puppeteer` → ^25.12.0 | WPPConnect asks for Puppeteer 24, whose `@puppeteer/browsers` pulls the vulnerable, abandoned `extract-zip` (two high advisories). Puppeteer 25 no longer uses it. The direct dependency uses the same range (npm requires it). See [README → Dependency security](README.md#dependency-security-puppeteer-override). |

`npm audit` reports 0 vulnerabilities with these overrides. Re-run it on every dependency bump, and test the WhatsApp flow live after bumping WPPConnect, wa-js or Puppeteer. Drop an override once WPPConnect itself depends on a fixed version.

`allowScripts` approves the install scripts of `puppeteer` (downloads Chrome), `sharp` (native binary) and `electron` (desktop runtime).

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change and run `npm run build && npm test`.
3. Check it manually with `npm start` (and `npm run electron` if relevant).
4. Open a PR describing **what** changed and **why**, with screenshots for UI changes.

## Reporting bugs

Open an issue with steps to reproduce, what you expected, and what happened instead. **Never paste tokens.** The **Diagnostics** button in the Pull requests view prints GitHub responses without the token, so its output is safe to share.

For security issues, see [SECURITY.md](SECURITY.md) instead.
