// Applies the saved theme before the first paint (no flash). Kept as a file, not inline,
// so the Content-Security-Policy can forbid inline scripts. Full logic: src/client/core/theme.ts.
try {
  const mode = localStorage.getItem("routine-chat.theme.v1") || "system";
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("sl-theme-dark", dark);
} catch {}
