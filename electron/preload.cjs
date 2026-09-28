const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAudio", {
  readBundledSoundFont: () => ipcRenderer.invoke("soundfont:read-bundled"),
});
