const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pdfFillerDesktop", {
  getInitialPdf: () => ipcRenderer.invoke("desktop:get-initial-pdf"),
  getAppVersion: () => ipcRenderer.invoke("desktop:get-app-version"),
  readPdfFile: (filePath) => ipcRenderer.invoke("desktop:read-pdf-file", filePath),
  getStartupEnabled: () => ipcRenderer.invoke("desktop:get-startup-enabled"),
  setStartupEnabled: (enabled) => ipcRenderer.invoke("desktop:set-startup-enabled", enabled),
  openDefaultAppSettings: () => ipcRenderer.invoke("desktop:open-default-app-settings"),
  savePdfFile: (payload) => ipcRenderer.invoke("desktop:save-pdf-file", payload),
  print: () => ipcRenderer.invoke("desktop:print"),
  getUpdateSettings: () => ipcRenderer.invoke("desktop:get-update-settings"),
  setUpdateSettings: (settings) => ipcRenderer.invoke("desktop:set-update-settings", settings),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  onUpdaterStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("updater-status", listener);
    return () => ipcRenderer.removeListener("updater-status", listener);
  },
  onUpdaterState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("updater-state", listener);
    return () => ipcRenderer.removeListener("updater-state", listener);
  },
  onPdfOpenedFromSystem: (callback) => {
    const listener = (_event, filePath) => callback(filePath);
    ipcRenderer.on("pdf-opened-from-system", listener);
    return () => ipcRenderer.removeListener("pdf-opened-from-system", listener);
  },
});
