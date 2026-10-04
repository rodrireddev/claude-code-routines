import "./theme.js";
import "./i18n.js";
import "./lock-screen.js";
import "./routine-chat.js";
import { store } from "./store.js";

/** Muestra la pantalla de bloqueo si hay datos cifrados; si no, el chat. */
function mount(): void {
  document.body.replaceChildren();
  if (store.locked) {
    const lock = document.createElement("lock-screen");
    lock.addEventListener("unlocked", mount);
    document.body.append(lock);
  } else {
    document.body.append(document.createElement("routine-chat"));
  }
}

store.addEventListener("lock", mount);
// The UI is rebuilt in the new language; data lives in the store, so nothing is lost.
window.addEventListener("langchange", mount);
mount();
