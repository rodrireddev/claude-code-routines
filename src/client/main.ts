import "./core/theme.js";
import "./core/i18n.js";
import "./components/login-screen.js";
import "./components/lock-screen.js";
import "./components/routine-chat.js";
import { authStatus } from "./core/api.js";
import { githubAuth } from "./core/github-auth.js";
import { store } from "./core/store.js";

/**
 * Decides which screen to show:
 * 1. login (only when the server requires a password and there is no session),
 * 2. lock screen (local data is encrypted and still locked),
 * 3. the app.
 */
let needsLogin = false;

function mount(): void {
  document.body.replaceChildren();
  if (needsLogin) {
    const screen = document.createElement("login-screen");
    screen.addEventListener("logged-in", () => { needsLogin = false; mount(); });
    document.body.append(screen);
  } else if (store.locked) {
    const lock = document.createElement("lock-screen");
    lock.addEventListener("unlocked", mount);
    document.body.append(lock);
  } else {
    void loadGithubToken().finally(() => document.body.append(document.createElement("routine-chat")));
  }
}

/**
 * The GitHub token lives on the server (one token for the whole app). Older versions kept it in
 * browser storage: it is moved to the server once and removed from the browser.
 */
async function loadGithubToken(): Promise<void> {
  await githubAuth.load();
  if (store.githubToken) {
    if (!githubAuth.token) await githubAuth.save(store.githubToken).catch(() => undefined);
    if (githubAuth.token) store.setGithubToken("");
  }
}

store.addEventListener("lock", mount);
// The UI is rebuilt in the new language; data lives in the store, so nothing is lost.
window.addEventListener("langchange", mount);
// Any API call answered with "login required" (expired session, logout) brings back the login screen.
window.addEventListener("auth-required", () => {
  if (needsLogin) return;
  needsLogin = true;
  mount();
});

const status = await authStatus().catch(() => ({ required: false, authenticated: true }));
needsLogin = status.required && !status.authenticated;
mount();
