const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const isDev = process.env.PDF_FILLER_DEV === "1";
let mainWindow = null;
let pendingPdfPath = null;
let currentUpdateStatus = "Updater ready";
let hasUnsavedChanges = false;
let closeAfterSave = false;
let currentUpdateState = {
  phase: "idle",
  status: "Updater ready",
  version: "",
  percent: 0,
};

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

function sendUpdateState(patch) {
  currentUpdateState = { ...currentUpdateState, ...patch };
  currentUpdateStatus = currentUpdateState.status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updater-status", currentUpdateState.status);
    mainWindow.webContents.send("updater-state", currentUpdateState);
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

  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("close", async (event) => {
    if (!hasUnsavedChanges || closeAfterSave) return;
    event.preventDefault();
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Save", "Discard", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Unsaved changes",
      message: "You have unsaved changes in this PDF.",
      detail: "Save before closing, discard your changes, or cancel and keep editing.",
    });
    if (result.response === 0) {
      mainWindow.webContents.send("save-before-close");
      return;
    }
    if (result.response === 1) {
      hasUnsavedChanges = false;
      closeAfterSave = true;
      mainWindow.close();
    }
  });
}

async function checkForUpdates(manual = false) {
  if (isDev) {
    sendUpdateState({ phase: "development", status: "Updates are disabled while running in development mode.", version: "", percent: 0 });
    return { ok: false, reason: "development" };
  }

  const settings = await getUpdateSettings();
  if (!settings.enabled && !manual) {
    sendUpdateState({ phase: "disabled", status: "Automatic update checks are turned off.", version: "", percent: 0 });
    return { ok: false, reason: "disabled" };
  }
  if (settings.provider === "github") {
    const [owner, repo] = String(settings.githubRepo || "").split("/").map((part) => part.trim());
    if (!owner || !repo) {
      sendUpdateState({ phase: "error", status: "Add a GitHub repo like owner/repo to enable auto updates.", version: "", percent: 0 });
      return { ok: false, reason: "missing-github-repo" };
    }
    autoUpdater.setFeedURL({ provider: "github", owner, repo });
  } else if (settings.feedUrl) {
    autoUpdater.setFeedURL({ provider: "generic", url: settings.feedUrl });
  } else {
    sendUpdateState({ phase: "error", status: "Add an update feed URL to enable auto updates.", version: "", percent: 0 });
    return { ok: false, reason: "missing-feed-url" };
  }

  autoUpdater.autoDownload = false;
  sendUpdateState({ phase: "checking", status: "Checking for updates...", version: "", percent: 0 });
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    sendUpdateState({ phase: "error", status: `Update check failed: ${error.message}`, version: "", percent: 0 });
    return { ok: false, reason: error.message };
  }
}

autoUpdater.on("checking-for-update", () => sendUpdateState({ phase: "checking", status: "Checking for updates...", version: "", percent: 0 }));
autoUpdater.on("update-available", (info) => sendUpdateState({ phase: "available", status: `Update ${info.version} is ready to download.`, version: info.version, percent: 0 }));
autoUpdater.on("update-not-available", () => sendUpdateState({ phase: "not-available", status: "You are on the latest version.", version: "", percent: 0 }));
autoUpdater.on("download-progress", (progress) => sendUpdateState({ phase: "downloading", status: `Downloading update ${Math.round(progress.percent)}%...`, percent: Math.round(progress.percent) }));
autoUpdater.on("error", (error) => sendUpdateState({ phase: "error", status: `Update error: ${error.message}`, version: "", percent: 0 }));
autoUpdater.on("update-downloaded", (info) => {
  sendUpdateState({ phase: "downloaded", status: `Update ${info.version} downloaded. Restarting to install...`, version: info.version, percent: 100 });
  setTimeout(() => {
    autoUpdater.quitAndInstall(true, true);
  }, 900);
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
    mainWindow.webContents.once("did-finish-load", () => {
      void checkForUpdates(false);
    });

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

ipcMain.handle("desktop:set-dirty", (_event, dirty) => {
  hasUnsavedChanges = Boolean(dirty);
  return hasUnsavedChanges;
});

ipcMain.handle("desktop:close-after-save", () => {
  hasUnsavedChanges = false;
  closeAfterSave = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

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

ipcMain.handle("desktop:print-pdf-file", async (_event, payload) => {
  if (!mainWindow) return { ok: false, reason: "No application window is available." };

  const tempDir = path.join(app.getPath("temp"), "pdf-filler-print");
  const tempPath = path.join(tempDir, `pdf-filler-${Date.now()}.pdf`);
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(tempPath, Buffer.from(payload.bytes));

  const printWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    title: "Print PDF",
    parent: mainWindow,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,
    },
  });
  printWindow.setMenu(null);

  const cleanup = async () => {
    if (!printWindow.isDestroyed()) printWindow.destroy();
    try {
      await fs.unlink(tempPath);
    } catch {
      // The temporary file may still be held by the print spooler; Windows will clear temp files later.
    }
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      setTimeout(() => {
        void cleanup();
      }, 1500);
      resolve(result);
    };

    printWindow.on("closed", () => finish({ ok: false, reason: "Print window was closed." }));
    printWindow.webContents.once("did-fail-load", (_event, _code, description) => {
      finish({ ok: false, reason: `Could not load the PDF for printing: ${description}` });
    });
    printWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        if (printWindow.isDestroyed()) {
          finish({ ok: false, reason: "Print window was closed." });
          return;
        }
        printWindow.webContents.print({ printBackground: true }, (success, failureReason) => {
          finish(success ? { ok: true } : { ok: false, reason: failureReason || "Print was canceled or failed." });
        });
      }, 500);
    });
    printWindow.loadURL(pathToFileURL(tempPath).toString()).catch((error) => {
      finish({ ok: false, reason: error.message });
    });
  });
});

ipcMain.handle("desktop:print", async () => {
  if (!mainWindow) return false;
  mainWindow.webContents.print({ printBackground: true });
  return true;
});

ipcMain.handle("desktop:get-update-settings", async () => {
  return { ...(await getUpdateSettings()), status: currentUpdateStatus, updateState: currentUpdateState };
});

ipcMain.handle("desktop:set-update-settings", async (_event, settings) => {
  return setUpdateSettings(settings);
});

ipcMain.handle("desktop:check-for-updates", async () => {
  return checkForUpdates(true);
});

ipcMain.handle("desktop:download-update", async () => {
  if (isDev) {
    sendUpdateState({ phase: "development", status: "Updates are disabled while running in development mode.", version: "", percent: 0 });
    return { ok: false, reason: "development" };
  }
  try {
    sendUpdateState({ phase: "downloading", status: "Downloading update...", percent: 0 });
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    sendUpdateState({ phase: "error", status: `Update download failed: ${error.message}`, percent: 0 });
    return { ok: false, reason: error.message };
  }
});
