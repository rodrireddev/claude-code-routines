/** Tema de la interfaz: sistema (por defecto), claro u oscuro. Persistido en localStorage. */
export type ThemeMode = "system" | "light" | "dark";

const KEY = "routine-chat.theme.v1";
const MODES: ThemeMode[] = ["system", "light", "dark"];
const mq = matchMedia("(prefers-color-scheme: dark)");

export function getTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (MODES.includes(v as ThemeMode)) return v as ThemeMode;
  } catch { /* ignorar */ }
  return "system";
}

function apply(): void {
  const mode = getTheme();
  const dark = mode === "dark" || (mode === "system" && mq.matches);
  document.documentElement.classList.toggle("sl-theme-dark", dark);
}

export function setTheme(mode: ThemeMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* ignorar */ }
  apply();
  window.dispatchEvent(new Event("themechange"));
}

/** sistema → claro → oscuro → sistema */
export function cycleTheme(): ThemeMode {
  const next = MODES[(MODES.indexOf(getTheme()) + 1) % MODES.length];
  setTheme(next);
  return next;
}

mq.addEventListener("change", apply);
apply();
