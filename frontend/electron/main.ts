import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PET_PACK, PET_PACKS, PET_SIZES, PET_BEHAVIOR, isPetPack } from "../src/petConfig";
import type { AmbientMode, PetPackId, PetSize, PetSettings, PetHitbox, PetAction } from "../src/petConfig";
import { advanceMotion } from "./pet-physics.mjs";
import type { MotionState } from "./pet-physics.mjs";

app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let petWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let ambientMode: AmbientMode = "pet";
let petPack: PetPackId = DEFAULT_PET_PACK;
let petSize: PetSize = 220;
let roaming = true;
let lastPetPosition: [number, number] | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let movementTimer: NodeJS.Timeout | null = null;
let motion: MotionState | null = null;
let activeAction: PetAction = "idle";
let hitbox: PetHitbox = { x: .08, y: .08, width: .84, height: .84 };
let dragging = false;
let menuOpen = false;

function settings(): PetSettings { return { mode: ambientMode, pack: petPack, size: petSize, roaming }; }
function settingsPath(): string { return join(app.getPath("userData"), "desktop-pet.json"); }
function windowSize(): number { return ambientMode === "ball" ? 92 : petSize; }

function loadSettings(): void {
  try {
    const saved = JSON.parse(readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;
    if (saved.mode === "ball" || saved.mode === "pet") ambientMode = saved.mode;
    if (isPetPack(saved.pack)) petPack = saved.pack;
    if (saved.pack === "rubber-duck") petPack = "doro";
    if (PET_SIZES.includes(saved.size as PetSize)) petSize = saved.size as PetSize;
    if (typeof saved.roaming === "boolean") roaming = saved.roaming;
    if (Array.isArray(saved.position) && saved.position.length === 2 && saved.position.every((value) => typeof value === "number" && Number.isFinite(value))) {
      lastPetPosition = [saved.position[0], saved.position[1]];
    }
  } catch { /* First run uses defaults. */ }
}

function saveSettings(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try { writeFileSync(settingsPath(), JSON.stringify({ ...settings(), position: lastPetPosition }), "utf8"); }
  catch (error) { console.error("Could not save desktop pet settings:", error); }
}
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 400);
}
function broadcastSettings(): void {
  for (const window of [mainWindow, petWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("pet-surface", settings());
  }
}
function visibleHitbox(): PetHitbox {
  const size = windowSize();
  if (ambientMode === "ball") return { x: 0, y: 0, width: size, height: size };
  return { x: hitbox.x * size, y: hitbox.y * size, width: hitbox.width * size, height: hitbox.height * size };
}
function clampPosition(x: number, y: number): [number, number] {
  const size = windowSize();
  const area = screen.getDisplayNearestPoint({ x: Math.round(x + size / 2), y: Math.round(y + size / 2) }).workArea;
  const box = visibleHitbox();
  const next = advanceMotion({ x, y, vx: 0, vy: 0 }, area, box, 0);
  return [next.x, next.y];
}
function placePet(x: number, y: number): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const size = windowSize();
  // Supplying the fixed size avoids cumulative DIP rounding during setPosition on Windows.
  petWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: size, height: size }, false);
}
function resetMotion(): void {
  if (!petWindow || petWindow.isDestroyed()) { motion = null; return; }
  const [x, y] = petWindow.getPosition();
  const speed = PET_BEHAVIOR.speedPixelsPerSecond;
  motion = { x, y, vx: motion?.vx || speed * .86, vy: motion?.vy || -speed * .51 };
}
function movementTick(seconds: number): void {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible() || ambientMode !== "pet" || !roaming || dragging || menuOpen || activeAction !== "walk") return;
  if (!motion) resetMotion();
  if (!motion) return;
  const area = screen.getDisplayMatching(petWindow.getBounds()).workArea;
  const next = advanceMotion(motion, area, visibleHitbox(), seconds);
  motion = next;
  placePet(next.x, next.y);
  if (next.hitX || next.hitY) petWindow.webContents.send("pet-motion", { direction: Math.sign(next.vx) || 1, hitX: next.hitX, hitY: next.hitY });
}

function loadRenderer(window: BrowserWindow, query?: Record<string, string>): void {
  const base = process.env.ELECTRON_RENDERER_URL;
  if (base) {
    const url = new URL(base);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    void window.loadURL(url.href);
  } else void window.loadFile(join(__dirname, "../renderer/index.html"), query ? { query } : undefined);
}
function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 680,
    backgroundColor: "#f4efe4", autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, "../preload/preload.mjs"), contextIsolation: true, sandbox: false, nodeIntegration: false }
  });
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    showAmbientWindow(ambientMode);
  });
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  loadRenderer(window);
  return window;
}
function createPetWindow(): BrowserWindow {
  const size = windowSize();
  dragging = false;
  activeAction = "idle";
  const window = new BrowserWindow({
    width: size, height: size, minWidth: size, minHeight: size, maxWidth: size, maxHeight: size,
    frame: false, transparent: true, backgroundColor: "#00000000", hasShadow: false,
    resizable: false, maximizable: false, fullscreenable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: { preload: join(__dirname, "../preload/preload.mjs"), contextIsolation: true, sandbox: false, nodeIntegration: false, zoomFactor: 1 }
  });
  window.setAlwaysOnTop(true, "floating");
  window.on("will-resize", (event) => event.preventDefault());
  window.on("resize", () => {
    // Also guard programmatic/OS resizing; never feed measured dimensions back into movement.
    const [width, height] = window.getSize();
    if (Math.abs(width - size) > 2 || Math.abs(height - size) > 2) {
      const [x, y] = window.getPosition();
      window.setBounds({ x, y, width: size, height: size }, false);
    }
  });
  window.webContents.setZoomFactor(1);
  void window.webContents.setVisualZoomLevelLimits(1, 1);
  window.webContents.on("before-input-event", (event, input) => {
    if ((input.control || input.meta) && ["+", "-", "=", "0"].includes(input.key)) event.preventDefault();
  });
  window.webContents.on("did-finish-load", () => {
    window.webContents.send("pet-surface", settings());
    window.webContents.send("pet-visible", window.isVisible());
  });
  window.on("show", () => window.webContents.send("pet-visible", true));
  window.on("hide", () => { activeAction = "idle"; dragging = false; window.webContents.send("pet-visible", false); });
  window.on("moved", () => {
    if (!window.isDestroyed()) { lastPetPosition = window.getPosition() as [number, number]; scheduleSave(); }
  });
  window.on("closed", () => { if (petWindow === window) petWindow = null; motion = null; });
  loadRenderer(window, { surface: ambientMode, pack: petPack });
  return window;
}
function showAmbientWindow(mode: AmbientMode): void {
  mainWindow?.hide();
  if (petWindow && !petWindow.isDestroyed() && mode !== ambientMode) {
    lastPetPosition = petWindow.getPosition() as [number, number];
    petWindow.destroy();
    petWindow = null;
  }
  ambientMode = mode;
  scheduleSave();
  if (!petWindow || petWindow.isDestroyed()) petWindow = createPetWindow();
  const size = windowSize();
  const area = screen.getPrimaryDisplay().workArea;
  const position = lastPetPosition ?? [area.x + area.width - size - 36, area.y + area.height - size - 36];
  placePet(...clampPosition(...position));
  resetMotion();
  petWindow.showInactive();
  broadcastSettings();
}
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus(); petWindow?.hide();
}
function setPetPack(next: string): void {
  if (!isPetPack(next)) return;
  petPack = next;
  scheduleSave(); broadcastSettings();
}
function setPetSize(next: number): void {
  if (!PET_SIZES.includes(next as PetSize) || next === petSize) return;
  const wasVisible = Boolean(petWindow?.isVisible());
  petSize = next as PetSize;
  if (petWindow && ambientMode === "pet") { petWindow.destroy(); petWindow = null; }
  if (wasVisible && ambientMode === "pet") showAmbientWindow("pet");
  scheduleSave(); broadcastSettings();
}
function setRoaming(next: boolean): void {
  roaming = next; scheduleSave(); broadcastSettings();
}
function showPetMenu(): void {
  menuOpen = true;
  const menu = Menu.buildFromTemplate([
    { label: "打开学习台", click: showMainWindow }, { type: "separator" },
    { label: "桌宠态", type: "radio", checked: ambientMode === "pet", click: () => showAmbientWindow("pet") },
    { label: "悬浮球态", type: "radio", checked: ambientMode === "ball", click: () => showAmbientWindow("ball") },
    { label: "自动移动 / 边缘反弹", type: "checkbox", checked: roaming, click: (item) => setRoaming(item.checked) },
    { label: "桌宠大小", submenu: PET_SIZES.map((size, index) => ({
      label: ["小", "中", "大"][index], type: "radio" as const, checked: size === petSize, click: () => setPetSize(size)
    })) },
    { label: "切换角色", submenu: PET_PACKS.map((pack) => ({
      label: pack.label, type: "radio" as const, checked: petPack === pack.id, click: () => setPetPack(pack.id)
    })) },
    { type: "separator" }, { label: "退出", click: () => { isQuitting = true; app.quit(); } }
  ]);
  menu.popup({ window: petWindow?.isVisible() ? petWindow : mainWindow ?? undefined, callback: () => { menuOpen = false; } });
}
function createTray(): void {
  const paths = [join(__dirname, "../../public/assets/doro/icon.png"), join(__dirname, "../renderer/assets/doro/icon.png")];
  const imagePath = paths.find((path) => existsSync(path));
  if (!imagePath) return;
  tray = new Tray(nativeImage.createFromPath(imagePath).resize({ width: 24, height: 24 }));
  tray.setToolTip("组卷助手");
  tray.on("click", showMainWindow); tray.on("right-click", showPetMenu);
}
function isPetSender(event: Electron.IpcMainEvent): boolean {
  return Boolean(petWindow && !petWindow.isDestroyed() && event.sender === petWindow.webContents && petWindow.isVisible());
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.paper-helper.desktop");
  loadSettings();
  mainWindow = createMainWindow();
  createTray();
  ipcMain.on("show-main", showMainWindow);
  ipcMain.on("show-ambient", (_event, mode) => showAmbientWindow(mode === "ball" ? "ball" : "pet"));
  ipcMain.on("set-pet-pack", (_event, pack) => setPetPack(pack));
  ipcMain.on("set-pet-size", (_event, size) => setPetSize(size));
  ipcMain.on("set-pet-roaming", (_event, next) => { if (typeof next === "boolean") setRoaming(next); });
  ipcMain.handle("get-pet-settings", settings);
  ipcMain.on("pet-context-menu", showPetMenu);
  ipcMain.on("pet-dragging", (event, next) => { if (isPetSender(event)) { dragging = next === true; resetMotion(); } });
  ipcMain.on("pet-action", (event, payload: { action: PetAction; hitbox: PetHitbox }) => {
    if (!isPetSender(event) || !payload || !["idle", "walk", "click", "special"].includes(payload.action)) return;
    const box = payload.hitbox;
    if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1.001 || box.y + box.height > 1.001) return;
    activeAction = payload.action; hitbox = box;
    const [x, y] = petWindow!.getPosition();
    placePet(...clampPosition(x, y)); resetMotion();
    petWindow!.webContents.send("pet-motion", { direction: Math.sign(motion?.vx ?? 1), hitX: false, hitY: false });
  });
  ipcMain.on("pet-drag-to", (event, point: { x: number; y: number }) => {
    if (!isPetSender(event) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    placePet(...clampPosition(point.x, point.y)); resetMotion();
  });
  ipcMain.on("quit-app", () => { isQuitting = true; app.quit(); });
  let previous = performance.now();
  movementTimer = setInterval(() => {
    const now = performance.now(); movementTick(Math.min((now - previous) / 1000, .1)); previous = now;
  }, PET_BEHAVIOR.moveIntervalMs);
  screen.on("display-metrics-changed", () => {
    if (!petWindow) return;
    placePet(...clampPosition(...petWindow.getPosition() as [number, number])); resetMotion();
  });
  app.on("activate", showMainWindow);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin" && isQuitting) app.quit(); });
app.on("before-quit", () => { isQuitting = true; if (movementTimer) clearInterval(movementTimer); saveSettings(); });
