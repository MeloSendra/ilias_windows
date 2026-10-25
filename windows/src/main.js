import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, shell, systemPreferences, Tray } from "electron";
import { existsSync } from "node:fs";
import { homedir, release } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR, LOG_PATH, NotRunningError, request, restartBackgroundJob } from "./daemon-client.js";
import { renderIcons } from "./icons.js";
import { headline, iconState, nextRunText, splitLabel } from "./shared/format.js";

const here = dirname(fileURLToPath(import.meta.url));
const preload = join(here, "preload.cjs");
/** Mica and acrylic backdrops need Windows 11 22H2 (build 22621) or newer. */
const hasMaterial = process.platform === "win32" && Number(release().split(".")[2]) >= 22621;
const FLYOUT_WIDTH = 368;

let tray;
let icons;
let flyout;
let settings;
let flyoutHiddenAt = 0;
/** Latest answer from the background job; null while it is unreachable. */
let status = null;
let statusError = null;

// ---------- status ----------

async function refresh() {
  try {
    status = await request("GET", "/api/status", undefined, { timeoutMs: 5000 });
    statusError = null;
  } catch (err) {
    status = null;
    statusError = err.message;
  }
  publish();
}

function publish() {
  const tooltip = ["ILIAS Sync", headline(status, statusError), nextRunText(status)].filter(Boolean).join("\n");
  tray?.setImage(icons.tray[iconState(status)]);
  tray?.setToolTip(tooltip.slice(0, 127));
  for (const win of [flyout, settings]) win?.webContents.send("status", { status, error: statusError });
}

async function daemonAction(path) {
  try {
    status = await request("POST", path);
    statusError = null;
  } catch (err) {
    statusError = err.message;
  }
  publish();
}

async function startBackgroundJob() {
  try {
    await restartBackgroundJob();
  } catch (err) {
    dialog.showErrorBox("Could not start the background sync", err.message);
    return;
  }
  // Give the job a moment to publish its port before asking it for its status.
  for (let i = 0; i < 10 && !status; i++) {
    await new Promise((r) => setTimeout(r, 700));
    await refresh();
  }
}

const actions = {
  sync: () => daemonAction("/api/sync"),
  pause: () => daemonAction("/api/pause"),
  resume: () => daemonAction("/api/resume"),
  "start-daemon": startBackgroundJob,
  settings: () => openSettings(),
  "show-log": () => shell.openPath(LOG_PATH),
  "open-config": () => shell.openPath(CONFIG_DIR),
  "hide-flyout": () => flyout?.hide(),
  quit: () => app.quit(),
};

// ---------- tray ----------

function buildMenu() {
  const running = !!status;
  const recent = status?.recent.slice(0, 8) ?? [];
  const courses = status?.courses ?? [];
  const info = [headline(status, statusError), status?.message, nextRunText(status)].filter(Boolean);
  return Menu.buildFromTemplate([
    ...info.map((label) => ({ label: label.length > 70 ? label.slice(0, 69) + "…" : label, enabled: false })),
    { type: "separator" },
    ...(running ? [] : [{ label: "Start Background Sync", click: actions["start-daemon"] }, { type: "separator" }]),
    {
      label: "Sync Now",
      enabled: running && status.state !== "syncing",
      click: actions.sync,
    },
    {
      label: status?.state === "paused" ? "Resume" : "Pause",
      enabled: running,
      click: status?.state === "paused" ? actions.resume : actions.pause,
    },
    { type: "separator" },
    {
      label: "Recent Files",
      visible: recent.length > 0,
      submenu: recent.map((file) => ({
        label: (file.updated ? "↻ " : "") + splitLabel(file.label).name,
        sublabel: splitLabel(file.label).where,
        click: () => shell.openPath(file.path),
      })),
    },
    {
      label: "Open Course Folder",
      visible: courses.length > 0,
      submenu: courses.map((course) => ({ label: course.title, click: () => shell.openPath(course.targetDir) })),
    },
    { label: "Show Log", click: actions["show-log"] },
    { type: "separator" },
    { label: "Settings…", click: actions.settings },
    { label: "Quit Tray App", click: actions.quit },
  ]);
}

function createTray() {
  tray = new Tray(icons.tray.offline);
  tray.setToolTip("ILIAS Sync");
  tray.on("click", toggleFlyout);
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));
}

// ---------- windows ----------

function themeColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { dark, background: dark ? "#202020" : "#f3f3f3", symbol: dark ? "#ffffff" : "#1b1b1b" };
}

function uiQuery() {
  return {
    accent: systemPreferences.getAccentColor?.().slice(0, 6) ?? "0f6cbd",
    material: hasMaterial ? "1" : "0",
  };
}

function windowOptions(extra) {
  return {
    show: false,
    icon: icons.app,
    backgroundColor: hasMaterial ? "#00000000" : themeColors().background,
    autoHideMenuBar: true,
    webPreferences: { preload, sandbox: true, contextIsolation: true },
    ...extra,
  };
}

function createFlyout() {
  flyout = new BrowserWindow(windowOptions({
    width: FLYOUT_WIDTH,
    height: 420,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundMaterial: hasMaterial ? "acrylic" : undefined,
  }));
  flyout.loadFile(join(here, "ui", "flyout.html"), { query: uiQuery() });
  flyout.on("blur", () => {
    flyout.hide();
    flyoutHiddenAt = Date.now();
  });
}

/** Places the flyout in the corner of the work area next to the taskbar, like Windows' own flyouts. */
function positionFlyout() {
  const t = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: t.x + t.width / 2, y: t.y + t.height / 2 });
  const { workArea: wa, bounds } = display;
  const [w, h] = flyout.getSize();
  const margin = 12;
  const x = wa.x > bounds.x ? wa.x + margin : wa.x + wa.width - w - margin;
  const y = wa.y > bounds.y ? wa.y + margin : wa.y + wa.height - h - margin;
  flyout.setPosition(Math.round(x), Math.round(y));
}

function toggleFlyout() {
  if (flyout.isVisible()) return flyout.hide();
  // Clicking the tray icon blurs (and hides) an open flyout first; don't reopen it right away.
  if (Date.now() - flyoutHiddenAt < 250) return;
  positionFlyout();
  flyout.show();
  flyout.focus();
  flyout.webContents.send("shown");
  refresh();
}

function openSettings(page) {
  flyout?.hide();
  if (settings) {
    if (settings.isMinimized()) settings.restore();
    settings.show();
    settings.focus();
    if (page) settings.webContents.send("navigate", page);
    return;
  }
  const { symbol } = themeColors();
  settings = new BrowserWindow(windowOptions({
    width: 940,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    title: "ILIAS Sync Settings",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#00000000", symbolColor: symbol, height: 44 },
    backgroundMaterial: hasMaterial ? "mica" : undefined,
  }));
  settings.loadFile(join(here, "ui", "settings.html"), { query: { ...uiQuery(), ...(page ? { page } : {}) } });
  settings.once("ready-to-show", () => settings.show());
  settings.on("closed", () => { settings = null; });
}

// ---------- IPC ----------

const loginItem = () => ({ path: process.execPath, args: [app.getAppPath()] });

function registerIpc() {
  ipcMain.handle("status:get", () => ({ status, error: statusError }));

  ipcMain.handle("api", async (_e, method, path, body) => {
    if (typeof path !== "string" || !path.startsWith("/api/")) return { error: "Invalid path" };
    try {
      const data = await request(method, path, body);
      if (method === "PUT") refresh();
      return { data };
    } catch (err) {
      return { error: err.message, notRunning: err instanceof NotRunningError };
    }
  });

  ipcMain.handle("action", async (_e, name) => {
    await actions[name]?.();
  });

  ipcMain.handle("app:info", () => ({
    homeDir: homedir(),
    logPath: LOG_PATH,
    configDir: CONFIG_DIR,
    openAtLogin: app.getLoginItemSettings(loginItem()).openAtLogin,
  }));

  ipcMain.handle("app:set-open-at-login", (_e, on) => {
    app.setLoginItemSettings({ ...loginItem(), openAtLogin: !!on });
    return app.getLoginItemSettings(loginItem()).openAtLogin;
  });

  ipcMain.handle("open-path", async (_e, path) => {
    const error = await shell.openPath(String(path));
    return error || null;
  });

  ipcMain.handle("pick-folder", async (e, start) => {
    // Start in the nearest folder that still exists.
    let dir = String(start || homedir());
    while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      defaultPath: dir,
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Choose",
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.on("flyout:resize", (_e, height) => {
    if (!flyout) return;
    const max = screen.getPrimaryDisplay().workAreaSize.height - 24;
    // Windows ignores size changes on non-resizable windows.
    flyout.setResizable(true);
    flyout.setSize(FLYOUT_WIDTH, Math.min(max, Math.ceil(height)));
    flyout.setResizable(false);
    if (flyout.isVisible()) positionFlyout();
  });
}

// ---------- lifecycle ----------

async function start() {
  Menu.setApplicationMenu(null);
  icons = await renderIcons();
  registerIpc();
  createTray();
  createFlyout();

  nativeTheme.on("updated", async () => {
    icons = await renderIcons();
    publish();
    settings?.setTitleBarOverlay({ symbolColor: themeColors().symbol });
    if (!hasMaterial) for (const win of [flyout, settings]) win?.setBackgroundColor(themeColors().background);
  });

  await refresh();
  setInterval(refresh, 5000);

  // At login the Startup entry may still be launching the job; wait briefly before starting it ourselves.
  if (!status) {
    await new Promise((r) => setTimeout(r, 4000));
    await refresh();
    if (!status) await startBackgroundJob();
  }
  if (status?.state === "needs-setup") openSettings("account");
}

app.setAppUserModelId("de.ilias-sync.tray");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching the app again (e.g. from the Start menu) opens the settings.
  app.on("second-instance", () => openSettings());
  // Keep running in the tray when the settings window is closed.
  app.on("window-all-closed", () => {});
  app.whenReady().then(start);
}
