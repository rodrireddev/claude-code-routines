import { fileURLToPath } from "node:url";
import { app, BrowserWindow, shell } from "electron";
import { startServer } from "../app.js";

// Puerto fijo: el origen (localhost:PORT) define el localStorage donde se guardan Trigger ID y Token.
const PORT = Number(process.env.PORT ?? 3000);

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    title: "Routine Chat",
    icon: fileURLToPath(new URL("../../public/assets/logo-512.png", import.meta.url)),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);

  // Los enlaces externos (p. ej. la sesión de Claude) se abren en el navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(`http://127.0.0.1:${PORT}`);
}

app.whenReady().then(async () => {
  await startServer(PORT);
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
