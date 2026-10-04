import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { createApp } from "../server/app.js";
import { loadConfig } from "../server/config.js";

/**
 * Desktop wrapper: runs the server in local mode (127.0.0.1, no login) and opens it in a window.
 * The port stays fixed because browser storage (conversations, settings) is per origin.
 */
async function createWindow(url: string): Promise<void> {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "Routine Chat",
    icon: fileURLToPath(new URL("../../public/assets/logo-512.png", import.meta.url)),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);

  // External links (e.g. the Claude session) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https:\/\//.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  await win.loadURL(url);
}

app.whenReady().then(async () => {
  const config = loadConfig({
    ...process.env,
    HOST: "127.0.0.1",
    DATA_DIR: process.env.DATA_DIR ?? join(app.getPath("userData"), "data"),
  });
  const server = createApp(config);
  await server.listen();
  const url = `http://127.0.0.1:${config.port}`;
  await createWindow(url);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow(url);
  });
  app.on("before-quit", () => void server.close());
});

app.on("window-all-closed", () => app.quit());
