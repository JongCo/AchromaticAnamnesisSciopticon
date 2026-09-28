const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const DEV_SERVER_ARG_PREFIX = "--dev-server=";
const MIDI_PERMISSIONS = new Set(["midi", "midiSysex"]);

const devServerUrl = process.argv
  .find((arg) => arg.startsWith(DEV_SERVER_ARG_PREFIX))
  ?.slice(DEV_SERVER_ARG_PREFIX.length);

function getTrustedOrigins() {
  const origins = new Set(["file://"]);
  if (devServerUrl) {
    origins.add(new URL(devServerUrl).origin);
  }
  return origins;
}

function isTrustedRendererUrl(rawUrl) {
  if (!rawUrl) return false;

  try {
    const url = new URL(rawUrl);
    if (url.protocol === "file:") return true;
    return getTrustedOrigins().has(url.origin);
  } catch {
    return false;
  }
}

function configurePermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || webContents.getURL();
    callback(MIDI_PERMISSIONS.has(permission) && isTrustedRendererUrl(requestingUrl));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const requestingUrl = details?.requestingUrl || requestingOrigin || webContents?.getURL();
    return MIDI_PERMISSIONS.has(permission) && isTrustedRendererUrl(requestingUrl);
  });
}

function configureSoundFontIpc() {
  ipcMain.handle("soundfont:read-bundled", async (event) => {
    const requestingUrl = event.senderFrame?.url || event.sender.getURL();
    if (!isTrustedRendererUrl(requestingUrl)) {
      throw new Error("Untrusted renderer cannot access the bundled SoundFont.");
    }

    const soundFontPath = path.join(app.getAppPath(), "dist", "soundfonts", "MuseScore_General.sf3");
    return new Uint8Array(await fs.readFile(soundFontPath));
  });
}

function keepNavigationInsideApp(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
  });
}

async function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: "AchromaticAnamnesisSciopticon",
    backgroundColor: "#101418",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  keepNavigationInsideApp(window);

  if (devServerUrl) {
    await window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(async () => {
  configurePermissions();
  configureSoundFontIpc();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
