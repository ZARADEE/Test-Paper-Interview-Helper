import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell, powerMonitor, Notification } from "electron";
import { TimerService } from './timer-service';
import { activeSession } from '../src/timer/model';
import type { TimerSnapshot, PaperLink } from '../src/timer/model';
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PET_PACK, PET_PACKS, PET_SIZES, PET_BEHAVIOR, isPetPack } from "../src/petConfig";
import type { AmbientMode, PetPackId, PetSize, PetSettings, PetHitbox, PetAction } from "../src/petConfig";
import { advanceMotion } from "./pet-physics.mjs";
import type { MotionState } from "./pet-physics.mjs";

app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let petWindow: BrowserWindow | null = null;
let todoWindow: BrowserWindow | null = null;
let timerWindow: BrowserWindow | null = null;
let timerService: TimerService | null = null;
let timerExpanded = false;
let timerHeight = 125;
let timerSide = 0;
let positioningTimer = false;
let timerHeld = false;
let audioReady = false;
let pendingSound: {play:boolean;volume:number} | null = null;
let alarmNotification: Notification | null = null;
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

function settings(): PetSettings { return { mode: ambientMode, pack: petPack, size: petSize, roaming, timerHeld }; }
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
  layoutTimer();
}
function resetMotion(): void {
  if (!petWindow || petWindow.isDestroyed()) { motion = null; return; }
  const [x, y] = petWindow.getPosition();
  const speed = PET_BEHAVIOR.speedPixelsPerSecond;
  motion = { x, y, vx: motion?.vx || speed * .86, vy: motion?.vy || -speed * .51 };
}
function movementTick(seconds: number): void {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible() || ambientMode !== "pet" || !roaming || timerHeld || dragging || menuOpen || activeAction !== "walk") return;
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
function timerSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return [mainWindow,petWindow,todoWindow,timerWindow].some(w=>w&&!w.isDestroyed()&&w.webContents===event.sender);
}
function timerVisible(): boolean {
  const s=timerService?.snapshot().session;
  return Boolean(petWindow?.isVisible()&&s&&(activeSession(s)||!s.resultHidden));
}
function overlaps(a:Electron.Rectangle,b:Electron.Rectangle):boolean{return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;}
function layoutTimer():void {
  if(positioningTimer||!timerWindow||timerWindow.isDestroyed())return;
  if(!timerVisible()){timerWindow.hide();return;}
  positioningTimer=true;
  try{
    const p=petWindow!.getBounds(),area=screen.getDisplayMatching(p).workArea;
    const width=Math.min(timerExpanded?330:266,area.width),height=Math.min(Math.max(105,timerHeight),Math.max(105,area.height-p.height-16));
    const avoid=todoWindow?.isVisible()?todoWindow.getBounds():null;
    const candidates=[{x:p.x+(p.width-width)/2,y:p.y-height-8},{x:p.x+(p.width-width)/2,y:p.y+p.height+8},{x:p.x-width-8,y:p.y},{x:p.x+p.width+8,y:p.y}];
    const fit=(r:Electron.Rectangle)=>r.x>=area.x&&r.y>=area.y&&r.x+r.width<=area.x+area.width&&r.y+r.height<=area.y+area.height&&(!avoid||!overlaps(r,avoid));
    const index=avoid&&overlaps(p,avoid)?undefined:[timerSide,...[0,1,2,3].filter(i=>i!==timerSide)].find(i=>fit({...candidates[i],width,height}));
    let r:Electron.Rectangle;
    if(index!==undefined){timerSide=index;r={...candidates[index],width,height};}
    else{
      const groupWidth=Math.max(width,p.width),groupHeight=height+8+p.height;
      let x=Math.max(area.x,Math.min(p.x,area.x+area.width-groupWidth));
      let y=Math.max(area.y,Math.min(p.y-height-8,area.y+area.height-groupHeight));
      r={x,y,width,height};
      if(avoid&&overlaps({...r,height:groupHeight},avoid)){x=area.x;y=area.y;r={x,y,width,height};}
      const nextPet={x:Math.round(x+(width-p.width)/2),y:Math.round(Math.min(y+height+8,area.y+area.height-p.height)),width:p.width,height:p.height};
      petWindow!.setBounds(nextPet,false);lastPetPosition=[nextPet.x,nextPet.y];timerSide=0;
    }
    r.x=Math.round(r.x);r.y=Math.round(r.y);
    const current=timerWindow.getBounds();
    if(['x','y','width','height'].some(k=>current[k as keyof Electron.Rectangle]!==r[k as keyof Electron.Rectangle]))timerWindow.setBounds(r,false);
    if(!timerWindow.webContents.isLoading()&&!timerWindow.isVisible())timerWindow.showInactive();
  }finally{positioningTimer=false;}
}
function createTimerWindow():void {
  if(timerWindow&&!timerWindow.isDestroyed())return;
  const w=new BrowserWindow({width:266,height:125,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,maximizable:false,minimizable:false,fullscreenable:false,alwaysOnTop:true,skipTaskbar:true,show:false,
    webPreferences:{preload:join(__dirname,'../preload/preload.mjs'),contextIsolation:true,sandbox:false,nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
  timerWindow=w;audioReady=false;w.setAlwaysOnTop(true,'floating');
  w.on('closed',()=>{if(timerWindow===w)timerWindow=null;audioReady=false;});
  w.on('blur',()=>{if(timerExpanded)w.webContents.send('timer-collapse');});
  w.once('ready-to-show',layoutTimer);loadRenderer(w,{surface:'timer'});
}
function sendTimerSound(action:{play:boolean;volume:number}):void{
  if(isQuitting)return;
  createTimerWindow();pendingSound=action;
  if(audioReady&&timerWindow&&!timerWindow.isDestroyed()){timerWindow.webContents.send('timer-sound',action);pendingSound=null;}
}
function openTimerMain(paper?:PaperLink):void{
  showMainWindow();const w=mainWindow!;
  const send=()=>w.webContents.send('timer-open',paper);
  if(w.webContents.isLoading())w.webContents.once('did-finish-load',send);else send();
}
function timerChanged(s:TimerSnapshot):void{
  const held=!!s.session&&(activeSession(s.session)||!s.session.resultHidden);
  if(timerHeld!==held){timerHeld=held;resetMotion();broadcastSettings();}
  for(const w of [mainWindow,timerWindow])if(w&&!w.isDestroyed())w.webContents.send('timer-state',s);
  layoutTimer();
}
function timerAlarm(s:TimerSnapshot):void{
  timerExpanded=true;layoutTimer();
  if(s.preferences.sound)sendTimerSound({play:true,volume:s.preferences.volume});
  if(!mainWindow?.isFocused()&&!timerVisible()&&Notification.isSupported()){
    alarmNotification=new Notification({title:'番茄钟时间到了',body:(s.session?.title??'本轮')+'：正在记录超时，点击查看计时。',silent:true});
    alarmNotification.on('click',()=>openTimerMain());alarmNotification.show();
  }
}
function createMainWindow(): BrowserWindow {
  // Timer ownership is independent of this renderer's lifetime.
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
    if (!window.isDestroyed()) { lastPetPosition = window.getPosition() as [number, number]; scheduleSave(); layoutTimer(); }
  });
  window.on("closed", () => { if (petWindow === window) petWindow = null; motion = null; });
  loadRenderer(window, { surface: ambientMode, pack: petPack });
  return window;
}
function showPetTodos(): void {
  if (!petWindow?.isVisible() || ambientMode !== "pet") return;
  if (!todoWindow || todoWindow.isDestroyed()) {
    const window = new BrowserWindow({
      width: 360, height: 430, minWidth: 360, maxWidth: 360, minHeight: 430, maxHeight: 430,
      frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      movable: false, alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: "#fffaf0",
      webPreferences: { preload: join(__dirname, "../preload/preload.mjs"), contextIsolation: true, sandbox: false, nodeIntegration: false, zoomFactor: 1 }
    });
    todoWindow = window;
    window.setAlwaysOnTop(true, "floating");
    window.on("closed", () => { if (todoWindow === window) todoWindow = null; });
    window.once("ready-to-show", () => { if (petWindow?.isVisible() && ambientMode === "pet") window.showInactive(); });
    loadRenderer(window, { surface: "todos" });
  }
  const area = screen.getDisplayMatching(petWindow.getBounds()).workArea;
  todoWindow.setBounds({ x: area.x + Math.max(0, area.width - 376), y: area.y + Math.max(0, area.height - 446), width: 360, height: 430 });
  if (!todoWindow.webContents.isLoading()) todoWindow.showInactive();
  layoutTimer();
}

function showAmbientWindow(mode: AmbientMode): void {
  mainWindow?.hide();
  if (mode !== "pet") todoWindow?.hide();
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
  layoutTimer();
}
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus(); petWindow?.hide(); todoWindow?.hide();
  timerWindow?.hide();
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
    { type: "separator" },
    { label: '查看当前计时', click:()=>openTimerMain() },
    { label: '退出后无法提醒；未结束计时下次打开恢复', enabled:false },
    { label: "退出", click: () => { isQuitting = true; app.quit(); } }
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
  timerService=new TimerService(join(app.getPath('userData'),'focus-timer.json'),timerChanged,timerAlarm,()=>{sendTimerSound({play:false,volume:0});alarmNotification?.close();});
  mainWindow = createMainWindow();
  createTimerWindow();
  ipcMain.handle('timer-get',event=>{if(!timerSender(event))throw Error('未知计时窗口');if(event.sender===timerWindow?.webContents){audioReady=true;if(pendingSound){event.sender.send('timer-sound',pendingSound);pendingSound=null;}}return timerService!.snapshot();});
  ipcMain.handle('timer-migrate',(event,raw,durations)=>{if(event.sender!==mainWindow?.webContents)throw Error('未知计时窗口');return timerService!.migrate(raw,durations);});
  ipcMain.handle('timer-command',(event,command)=>{if(!timerSender(event))throw Error('未知计时窗口');return timerService!.command(command);});
  ipcMain.on('timer-sound-error',(event,failed)=>{if(event.sender===timerWindow?.webContents&&typeof failed==='boolean'){timerService!.soundError=failed?'提示音无法播放，请点击试听检查；视觉提醒和计时仍有效。':undefined;timerChanged(timerService!.snapshot());}});
  ipcMain.on('timer-expand',(event,value)=>{if(event.sender===timerWindow?.webContents&&typeof value==='boolean'){timerExpanded=value;layoutTimer();}});
  ipcMain.on('timer-resize',(event,value)=>{if(event.sender===timerWindow?.webContents&&Number.isFinite(value)){timerHeight=Math.max(105,Math.min(800,Math.ceil(value)));layoutTimer();}});
  ipcMain.on('timer-drag',(event,p)=>{if(event.sender!==timerWindow?.webContents||!petWindow||!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))return;const [x,y]=petWindow.getPosition();placePet(...clampPosition(x+Math.max(-2000,Math.min(2000,p.x)),y+Math.max(-2000,Math.min(2000,p.y))));resetMotion();});
  ipcMain.on('timer-open',event=>{if(timerSender(event))openTimerMain();});
  ipcMain.on('timer-open-paper',(event,p)=>{if(timerSender(event)&&p&&typeof p.id==='string'&&p.id.length<=150&&(p.version===undefined||typeof p.version==='string'))openTimerMain(p);});
  ipcMain.on('timer-preview-sound',(event,volume)=>{if(timerSender(event)&&Number.isFinite(volume)&&volume>=0&&volume<=1)sendTimerSound({play:true,volume});});
  powerMonitor.on('suspend',()=>timerService?.suspend());powerMonitor.on('resume',()=>timerService?.resume());
  createTray();
  ipcMain.on("show-main", showMainWindow);
  ipcMain.on("open-review", (event) => {
    if (![mainWindow, todoWindow, petWindow].some(window => window && !window.isDestroyed() && window.webContents === event.sender)) return;
    showMainWindow();
    const contents = mainWindow!.webContents;
    if (contents.isLoading()) contents.once("did-finish-load", () => contents.send("open-review"));
    else contents.send("open-review");
  });
  ipcMain.on("show-ambient", (_event, mode) => showAmbientWindow(mode === "ball" ? "ball" : "pet"));
  ipcMain.on("set-pet-pack", (_event, pack) => setPetPack(pack));
  ipcMain.on("set-pet-size", (_event, size) => setPetSize(size));
  ipcMain.on("set-pet-roaming", (_event, next) => { if (typeof next === "boolean") setRoaming(next); });
  ipcMain.handle("get-pet-settings", settings);
  ipcMain.on("pet-context-menu", showPetMenu);
  ipcMain.on("show-pet-todos", event => { if (isPetSender(event)) showPetTodos(); });
  ipcMain.on("hide-pet-todos", event => { if (todoWindow && event.sender === todoWindow.webContents) todoWindow.hide(); });
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
  screen.on('display-removed',()=>{if(petWindow)placePet(...clampPosition(...petWindow.getPosition() as [number,number]));layoutTimer();});
});
app.on("window-all-closed", () => { if (process.platform !== "darwin" && isQuitting) app.quit(); });
app.on("before-quit", () => { isQuitting = true; if (movementTimer) clearInterval(movementTimer); timerService?.close(); saveSettings(); });
