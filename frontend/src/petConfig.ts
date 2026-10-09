import animations from "./petAnimations.json";
export type AmbientMode = "pet" | "ball";
export type PetAction = "idle" | "walk" | "special" | "click";

export const PET_PACKS = [
  { id: "maid", label: "蓝发女仆", accent: "#52d7ff" },
  { id: "paper-cat", label: "纸盒猫", accent: "#ffd23f" },
  { id: "focus-bot", label: "专注机器人", accent: "#35c96e" },
  { id: "doro", label: "Doro", accent: "#f7afd1" }
] as const;
export type PetPackId = (typeof PET_PACKS)[number]["id"];
export const PET_SIZES = [160, 220, 280] as const;
export type PetSize = (typeof PET_SIZES)[number];
export type PetSettings = { mode: AmbientMode; pack: PetPackId; size: PetSize; roaming: boolean };
export type PetHitbox = { x: number; y: number; width: number; height: number };
export type PetMotion = { direction: number; hitX: boolean; hitY: boolean };
export const DEFAULT_PET_PACK: PetPackId = "maid";
export function isPetPack(value: unknown): value is PetPackId {
  return PET_PACKS.some((pack) => pack.id === value);
}

// Walk around the desktop, with regular rests and short interaction breaks.
export const PET_BEHAVIOR = {
  idleMinMs: 5000,
  idleMaxMs: 9000,
  walkProbability: 0.5,
  walkMinMs: 6000,
  walkMaxMs: 10000,
  specialMs: 2200,
  clickMs: 1600,
  speedPixelsPerSecond: 60,
  moveIntervalMs: 33
} as const;

export function petActionDuration(pack: PetPackId, action: "click" | "special"): number {
  return pack === "maid" || pack === "doro" ? animations[pack][action].durationMs : action === "click" ? 560 : 900;
}

export function petFacing(pack: PetPackId, direction: number): number {
  // The original Doro walking artwork faces left.
  return pack === "doro" ? -direction : direction;
}
export function petHitbox(pack: PetPackId, action: PetAction, direction = 1): PetHitbox {
  if (pack !== "maid" && pack !== "doro") return { x: .06, y: .03, width: .88, height: .93 };
  const [left, top, right, bottom] = animations[pack][action].bounds;
  return { x: (petFacing(pack, direction) < 0 ? 256 - right : left) / 256, y: top / 256, width: (right - left) / 256, height: (bottom - top) / 256 };
}

export function petAsset(path: string): string {
  // Relative URLs work both on the Vite server and in file:// builds.
  return new URL(`./assets/${path}`, document.baseURI).href;
}
