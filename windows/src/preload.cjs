// Sandboxed preloads must be CommonJS.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ilias", {
  /** Calls the background job's control API. Resolves to { data } or { error, notRunning }. */
  api: (method, path, body) => ipcRenderer.invoke("api", method, path, body),
  status: () => ipcRenderer.invoke("status:get"),
  onStatus: (callback) => ipcRenderer.on("status", (_e, value) => callback(value)),
  action: (name) => ipcRenderer.invoke("action", name),
  info: () => ipcRenderer.invoke("app:info"),
  setOpenAtLogin: (on) => ipcRenderer.invoke("app:set-open-at-login", on),
  open: (path) => ipcRenderer.invoke("open-path", path),
  pickFolder: (start) => ipcRenderer.invoke("pick-folder", start),
  resizeFlyout: (height) => ipcRenderer.send("flyout:resize", height),
  on: (channel, callback) => {
    if (["shown", "navigate"].includes(channel)) ipcRenderer.on(channel, (_e, value) => callback(value));
  },
});
