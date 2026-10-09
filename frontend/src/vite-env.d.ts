/// <reference types="vite/client" />
import type { PetAction, PetHitbox, PetMotion, PetSettings, PetSize } from "./petConfig";

declare global {
  interface Window {
    paperHelper?: {
      platform: string;
      mobileUrl: string;
      mobileHost: string;
      showPetTodos: () => void;
      hidePetTodos: () => void;
      showMain: () => void;
      showAmbient: (mode: "pet" | "ball") => void;
      setPetPack: (pack: string) => void;
      setPetSize: (size: PetSize) => void;
      setPetRoaming: (roaming: boolean) => void;
      getPetSettings: () => Promise<PetSettings>;
      showPetMenu: () => void;
      setPetDragging: (dragging: boolean) => void;
      dragPetTo: (x: number, y: number) => void;
      setPetAction: (action: PetAction, hitbox: PetHitbox) => void;
      onPetVisible: (callback: (visible: boolean) => void) => () => void;
      quitApp: () => void;
      onPetSurface: (callback: (payload: PetSettings) => void) => () => void;
      onPetMotion: (callback: (motion: PetMotion) => void) => () => void;
    };
  }
}

export {};
