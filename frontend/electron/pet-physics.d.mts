export type MotionState = { x: number; y: number; vx: number; vy: number };
export type Rectangle = { x: number; y: number; width: number; height: number };
export function advanceMotion(state: MotionState, area: Rectangle, hitbox: Rectangle, seconds: number): MotionState & { hitX: boolean; hitY: boolean };
