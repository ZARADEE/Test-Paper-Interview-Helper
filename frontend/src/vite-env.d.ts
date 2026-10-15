/// <reference types="vite/client" />
import type { PetAction, PetHitbox, PetMotion, PetSettings, PetSize } from "./petConfig";

declare global {
  interface Window {
    paperBoot?: { modulesReady: () => void; ready: () => void; fail: (error: unknown) => void };
    paperHelper?: {
      getTimer: () => Promise<import('./timer/model').TimerSnapshot>;
      reportTimerSound: (failed:boolean)=>void;
      onTimerCollapse: (callback:()=>void)=>()=>void;
      migrateTimer: (raw: unknown,durations: unknown) => Promise<import('./timer/model').TimerSnapshot>;
      timerCommand: (c: import('./timer/model').TimerCommand) => Promise<import('./timer/model').TimerReply>;
      onTimerState: (callback: (s: import('./timer/model').TimerSnapshot)=>void)=>()=>void;
      onTimerSound: (callback: (s:{play:boolean;volume:number})=>void)=>()=>void;
      onTimerOpen: (callback: (p?:import('./timer/model').PaperLink)=>void)=>()=>void;
      expandTimer: (expanded:boolean)=>void;
      resizeTimer: (height:number)=>void;
      dragTimerBy: (x:number,y:number)=>void;
      previewTimerSound: (volume:number)=>void;
      openTimer: ()=>void;
      openTimerPaper: (paper:import('./timer/model').PaperLink)=>void;
      platform: string;
      mobileUrl: string;
      mobileHost: string;
      showPetTodos: () => void;
      hidePetTodos: () => void;
      showMain: () => void;
      openReview: () => void;
      onOpenReview: (callback: () => void) => () => void;
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
