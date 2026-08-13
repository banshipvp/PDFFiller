const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");

const isDev = process.env.PDF_FILLER_DEV === "1";
let mainWindow = null;
let pendingPdfPath = null;
let currentUpdateStatus = "Updater ready";

function updateSettingsPath() {
  return path.join(app.getPath("userData"), "update-settings.json");
}

async function getUpdateSettings() {
  try {
    const raw = await fs.readFile(updateSettingsPath(), "utf8");
    return { enabled: true, provider: "github", githubRepo: "banshipvp/PDFFiller", feedUrl: "", ...JSON.parse(raw) };
  } catch {
    return { enabled: true, provider: "github", githubRepo: "banshipvp/PDFFiller", feedUrl: "" };
  }
}

async function setUpdateSettings(settings) {
  const current = await getUpdateSettings();
  const next = { ...current, ...settings };
  await fs.mkdir(path.dirname(updateSettingsPath()), { recursive: true });
  await fs.writeFile(updateSettingsPath(), JSON.stringify(next, null, 2));
  return next;
}

function sendUpdateStatus(status) {
  currentUpdateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updater-status", status);
  }
}

function findPdfArg(argv) {
  return argv.find((arg) => /\.pdf$/i.test(arg) && !arg.startsWith("--")) || null;
}

async function readPdfPayload(filePath) {
  const bytes = await fs.readFile(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function sendPdfToWindow(filePath) {
  if (!filePath) return;
  if (!mainWindow || !mainWindow.webContents) {
    pendingPdfPath = filePath;
    return;
  }
  mainWindow.webContents.send("pdf-opened-from-system", filePath);
}

function createWindow() {
  const iconPath = path.join(__dirname, "..", "assets", "app-icon.png");
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 680,
    title: `PDF Filler ${app.getVersion()}`,
    backgroundColor: "#f1f5f9",
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function checkForUpdates(manual = false) {
  if (isDev) {
    sendUpdateStatus("Updates are disabled while running in development mode.");
    return { ok: false, reason: "development" };
  }

  const settings = await getUpdateSettings();
  if (!settings.enabled && !manual) {
    sendUpdateStatus("Automatic update checks are turned off.");
    return { ok: false, reason: "disabled" };
  }
  if (settings.provider === "github") {
    const [owner, repo] = String(settings.githubRepo || "").split("/").map((part) => part.trim());
    if (!owner || !repo) {
      sendUpdateStatus("Add a GitHub repo like owner/repo to enable auto updates.");
      return { ok: false, reason: "missing-github-repo" };
    }
    autoUpdater.setFeedURL({ provider: "github", owner, repo });
  } else if (settings.feedUrl) {
    autoUpdater.setFeedURL({ provider: "generic", url: settings.feedUrl });
  } else {
    sendUpdateStatus("Add an update feed URL to enable auto updates.");
    return { ok: false, reason: "missing-feed-url" };
  }

  autoUpdater.autoDownload = true;
  sendUpdateStatus("Checking for updates...");
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    sendUpdateStatus(`Update check failed: ${error.message}`);
    return { ok: false, reason: error.message };
  }
}

autoUpdater.on("checking-for-update", () => sendUpdateStatus("Checking for updates..."));
autoUpdater.on("update-available", (info) => sendUpdateStatus(`Update ${info.version} found. Downloading...`));
autoUpdater.on("update-not-available", () => sendUpdateStatus("You are on the latest version."));
autoUpdater.on("download-progress", (progress) => sendUpdateStatus(`Downloading update ${Math.round(progress.percent)}%...`));
autoUpdater.on("error", (error) => sendUpdateStatus(`Update error: ${error.message}`));
autoUpdater.on("update-downloaded", async (info) => {
  sendUpdateStatus(`Update ${info.version} downloaded.`);
  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    buttons: ["Restart and install", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "Update ready",
    message: `PDF Filler ${info.version} has been downloaded.`,
    detail: "Restart the app now to install the update.",
  });
  if (result.response === 0) {
    autoUpdater.quitAndInstall(false, true);
  }
});

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const filePath = findPdfArg(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    sendPdfToWindow(filePath);
  });

  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    sendPdfToWindow(filePath);
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    pendingPdfPath = findPdfArg(process.argv);
    createWindow();
    setTimeout(() => {
      void checkForUpdates(false);
    }, 3500);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("desktop:get-initial-pdf", async () => {
  if (!pendingPdfPath) return null;
  const filePath = pendingPdfPath;
  pendingPdfPath = null;
  return readPdfPayload(filePath);
});

ipcMain.handle("desktop:get-app-version", () => app.getVersion());

ipcMain.handle("desktop:read-pdf-file", async (_event, filePath) => readPdfPayload(filePath));

ipcMain.handle("desktop:get-startup-enabled", () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("desktop:set-startup-enabled", (_event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.execPath,
  });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("desktop:open-default-app-settings", async () => {
  await shell.openExternal("ms-settings:defaultapps");
});

ipcMain.handle("desktop:save-pdf-file", async (_event, payload) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save PDF",
    defaultPath: payload.defaultName || "filled.pdf",
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, Buffer.from(payload.bytes));
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("desktop:print", async () => {
  if (!mainWindow) return false;
  mainWindow.webContents.print({ printBackground: true });
  return true;
});

ipcMain.handle("desktop:get-update-settings", async () => {
  return { ...(await getUpdateSettings()), status: currentUpdateStatus };
});

ipcMain.handle("desktop:set-update-settings", async (_event, settings) => {
  return setUpdateSettings(settings);
});

ipcMain.handle("desktop:check-for-updates", async () => {
  return checkForUpdates(true);
});
