import { contextBridge, ipcRenderer } from "electron";
import type { PetAction, PetHitbox, PetMotion, PetSettings, PetSize } from "../src/petConfig";

contextBridge.exposeInMainWorld("paperHelper", {
  platform: process.platform,
  mobileUrl: process.env.PAPER_HELPER_MOBILE_URL ?? "",
  mobileHost: process.env.PAPER_HELPER_MOBILE_HOST ?? "",
  showMain: () => ipcRenderer.send("show-main"),
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
