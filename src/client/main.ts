import "./theme.js";
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
mount();
