const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("argentumDesktop", {
  chooseFolder: () => ipcRenderer.invoke("argentum:choose-folder"),
  getClipOutputFolder: () => ipcRenderer.invoke("argentum:get-clip-output-folder"),
  chooseClipOutputFolder: () => ipcRenderer.invoke("argentum:choose-clip-output-folder"),
  saveClipToOutputFolder: (payload = {}) => ipcRenderer.invoke("argentum:save-clip-to-output-folder", payload),
  chooseFile: (options = {}) => ipcRenderer.invoke("argentum:choose-file", options),
  readImageFile: (targetPath) => ipcRenderer.invoke("argentum:read-image-file", targetPath),
  pickFolder: () => ipcRenderer.invoke("argentum:choose-folder"),
  openPath: (targetPath) => ipcRenderer.invoke("argentum:open-path", targetPath),
  openRobinhoodOAuth: (targetUrl) => ipcRenderer.invoke("argentum:open-robinhood-oauth", targetUrl),
  platform: process.platform,
});
