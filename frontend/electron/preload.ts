import { contextBridge, ipcRenderer } from "electron";
import type { PetAction, PetHitbox, PetMotion, PetSettings, PetSize } from "../src/petConfig";

contextBridge.exposeInMainWorld("paperHelper", {
  getTimer: () => ipcRenderer.invoke('timer-get'),
  reportTimerSound: (failed:boolean) => ipcRenderer.send('timer-sound-error',failed),
  onTimerCollapse: (callback: () => void) => { const listener=()=>callback();ipcRenderer.on('timer-collapse',listener);return()=>ipcRenderer.removeListener('timer-collapse',listener); },
  migrateTimer: (raw: unknown, durations: unknown) => ipcRenderer.invoke('timer-migrate', raw, durations),
  timerCommand: (command: unknown) => ipcRenderer.invoke('timer-command', command),
  expandTimer: (expanded: boolean) => ipcRenderer.send('timer-expand', expanded),
  resizeTimer: (height: number) => ipcRenderer.send('timer-resize', height),
  dragTimerBy: (x: number,y: number) => ipcRenderer.send('timer-drag', {x,y}),
  previewTimerSound: (volume: number) => ipcRenderer.send('timer-preview-sound', volume),
  openTimer: () => ipcRenderer.send('timer-open'),
  openTimerPaper: (paper: unknown) => ipcRenderer.send('timer-open-paper', paper),
  onTimerOpen: (callback: (paper?: import('../src/timer/model').PaperLink) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, paper?: import('../src/timer/model').PaperLink) => callback(paper);
    ipcRenderer.on('timer-open',listener);return ()=>ipcRenderer.removeListener('timer-open',listener);
  },
  onTimerState: (callback: (s: import('../src/timer/model').TimerSnapshot) => void) => {
    const listener = (_e: Electron.IpcRendererEvent,s: import('../src/timer/model').TimerSnapshot) => callback(s);
    ipcRenderer.on('timer-state',listener);return ()=>ipcRenderer.removeListener('timer-state',listener);
  },
  onTimerSound: (callback: (s: {play:boolean;volume:number}) => void) => {
    const listener = (_e: Electron.IpcRendererEvent,s: {play:boolean;volume:number}) => callback(s);
    ipcRenderer.on('timer-sound',listener);return ()=>ipcRenderer.removeListener('timer-sound',listener);
  },
  platform: process.platform,
  mobileUrl: process.env.PAPER_HELPER_MOBILE_URL ?? "",
  mobileHost: process.env.PAPER_HELPER_MOBILE_HOST ?? "",
  showPetTodos: () => ipcRenderer.send("show-pet-todos"),
  hidePetTodos: () => ipcRenderer.send("hide-pet-todos"),
  showMain: () => ipcRenderer.send("show-main"),
  openReview: () => ipcRenderer.send("open-review"),
  onOpenReview: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-review", listener);
    return () => ipcRenderer.removeListener("open-review", listener);
  },
  showAmbient: (mode: "pet" | "ball") => ipcRenderer.send("show-ambient", mode),
  setPetPack: (pack: string) => ipcRenderer.send("set-pet-pack", pack),
  setPetSize: (size: PetSize) => ipcRenderer.send("set-pet-size", size),
  setPetRoaming: (roaming: boolean) => ipcRenderer.send("set-pet-roaming", roaming),
  getPetSettings: () => ipcRenderer.invoke("get-pet-settings"),
  showPetMenu: () => ipcRenderer.send("pet-context-menu"),
  setPetDragging: (dragging: boolean) => ipcRenderer.send("pet-dragging", dragging),
  dragPetTo: (x: number, y: number) => ipcRenderer.send("pet-drag-to", { x, y }),
  setPetAction: (action: PetAction, hitbox: PetHitbox) => ipcRenderer.send("pet-action", { action, hitbox }),
  quitApp: () => ipcRenderer.send("quit-app"),
  onPetVisible: (callback: (visible: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, visible: boolean) => callback(visible);
    ipcRenderer.on("pet-visible", listener);
    return () => ipcRenderer.removeListener("pet-visible", listener);
  },
  onPetSurface: (callback: (payload: PetSettings) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: PetSettings) => callback(payload);
    ipcRenderer.on("pet-surface", listener);
    return () => ipcRenderer.removeListener("pet-surface", listener);
  },
  onPetMotion: (callback: (motion: PetMotion) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, motion: PetMotion) => callback(motion);
    ipcRenderer.on("pet-motion", listener);
    return () => ipcRenderer.removeListener("pet-motion", listener);
  }
});
