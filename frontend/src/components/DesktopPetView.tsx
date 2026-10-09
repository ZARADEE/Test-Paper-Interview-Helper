import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { DEFAULT_PET_PACK, PET_BEHAVIOR, PET_PACKS, isPetPack, petAsset, petFacing, petHitbox, petActionDuration } from "../petConfig";
import type { AmbientMode, PetAction, PetPackId, PetSettings } from "../petConfig";

function PaperCat({ action }: { action: PetAction }): JSX.Element {
  return (
    <svg className={`pet-svg pet-svg-cat is-${action}`} viewBox="0 0 220 260" aria-hidden="true">
      <path className="pet-tail" d="M159 191q61-2 42-50" fill="none" stroke="#c5a076" strokeWidth="16" strokeLinecap="round" />
      <path d="M45 96 30 45l48 27c18-8 46-8 64 0l48-27-15 51c12 18 14 47 6 71-13 39-47 59-78 59s-65-20-78-59c-8-24-6-53 6-71Z" fill="#fffaf0" stroke="#4b3b32" strokeWidth="6" strokeLinejoin="round" />
      <path d="m44 64 9 25 16-10m84 0 16 10 8-25" fill="#efaaa3" />
      <path d="M48 180h123v58H48Z" fill="#d9b783" stroke="#4b3b32" strokeWidth="6" />
      <path d="m48 180-12 15h61l13-15 14 15h61l-14-15M110 197v38" fill="#ecd0a5" stroke="#4b3b32" strokeWidth="4" strokeLinejoin="round" />
      <g className="pet-eyes"><ellipse cx="83" cy="125" rx="6" ry="9" fill="#4b3b32" /><ellipse cx="137" cy="125" rx="6" ry="9" fill="#4b3b32" /></g>
      <path d="m105 142 5 5 5-5m-5 5q-8 13-16 1m16-1q8 13 16 1M53 143l-24-3m27 16-24 5m142-18 24-3m-27 16 24 5" fill="none" stroke="#4b3b32" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="71" cy="149" rx="10" ry="5" fill="#efaaa3" /><ellipse cx="149" cy="149" rx="10" ry="5" fill="#efaaa3" />
      <path d="M61 178q0-21 18-19 16 1 15 19m31 0q0-20 17-19 17 0 17 19" fill="#fffaf0" stroke="#4b3b32" strokeWidth="5" />
    </svg>
  );
}

function FocusBot({ action }: { action: PetAction }): JSX.Element {
  return (
    <svg className={`pet-svg pet-svg-bot is-${action}`} viewBox="0 0 220 260" aria-hidden="true">
      <path d="M110 28v20" stroke="#263f4a" strokeWidth="7" strokeLinecap="round" />
      <circle cx="110" cy="23" r="9" fill="#ffba61" stroke="#263f4a" strokeWidth="5" />
      <rect x="40" y="46" width="140" height="114" rx="28" fill="#d7ecea" stroke="#263f4a" strokeWidth="6" />
      <rect x="57" y="67" width="106" height="60" rx="18" fill="#244956" />
      <g className="pet-eyes"><path d="M76 95h15m38 0h15" stroke="#8df9ce" strokeWidth="8" strokeLinecap="round" /></g>
      <path d="M103 113h14" stroke="#8df9ce" strokeWidth="4" strokeLinecap="round" />
      <rect x="64" y="159" width="92" height="60" rx="18" fill="#edf8f5" stroke="#263f4a" strokeWidth="6" />
      <path className="pet-arm" d="m57 171-24 24m132-24 22 21" stroke="#263f4a" strokeWidth="12" strokeLinecap="round" />
      <path d="M82 219v14h-15m71-14v14h15" fill="none" stroke="#263f4a" strokeWidth="10" strokeLinecap="round" />
      <rect x="90" y="177" width="40" height="19" rx="5" fill="#35c96e" />
      <path d="m100 186 6 5 13-12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PetArtwork({ pack, action = "idle", paused = false }: { pack: PetPackId; action?: PetAction; paused?: boolean }): JSX.Element {
  if (pack === "paper-cat") return <PaperCat action={action} />;
  if (pack === "focus-bot") return <FocusBot action={action} />;
  const clip = pack === "maid" && action === "special" ? "click" : action;
  return <img className={"pet-artwork is-" + action} src={petAsset(pack + "/" + clip + (paused ? ".png" : ".webp"))} alt="" draggable={false} />;
}

export function DesktopPetView(): JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const initialPack = params.get("pack");
  const [mode, setMode] = useState<AmbientMode>(params.get("surface") === "ball" ? "ball" : "pet");
  const [pack, setPack] = useState<PetPackId>(isPetPack(initialPack) ? initialPack : DEFAULT_PET_PACK);
  const [roaming, setRoaming] = useState(true);
  const [action, setAction] = useState<PetAction>("idle");
  const [actionCycle, setActionCycle] = useState(0);
  const [visible, setVisible] = useState(!document.hidden);
  const [dragging, setDragging] = useState(false);
  const [direction, setDirection] = useState(1);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const packMeta = PET_PACKS.find((item) => item.id === pack)!;

  useEffect(() => {
    let active = true;
    const applySettings = (settings: PetSettings) => {
      if (!active) return;
      setMode(settings.mode);
      if (isPetPack(settings.pack)) setPack(settings.pack);
      setRoaming(settings.roaming);
    };
    const removeSettings = window.paperHelper?.onPetSurface(applySettings);
    void window.paperHelper?.getPetSettings().then(applySettings).catch(() => {});
    const removeVisible = window.paperHelper?.onPetVisible(setVisible);
    const removeMotion = window.paperHelper?.onPetMotion((motion) => setDirection(motion.direction < 0 ? -1 : 1));
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false; removeSettings?.(); removeVisible?.(); removeMotion?.();
      window.paperHelper?.setPetDragging(false);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    setAction(mode === "pet" && visible && roaming ? "walk" : "idle");
    setActionCycle((value) => value + 1);
    if (!visible) { dragRef.current = null; setDragging(false); window.paperHelper?.setPetDragging(false); }
  }, [pack, mode, visible, roaming]);

  useEffect(() => {
    if (!visible) return;
    window.paperHelper?.setPetAction(mode === "pet" ? action : "idle", petHitbox(pack, action, direction));
  }, [pack, mode, action, direction, visible]);

  useEffect(() => {
    if (mode !== "pet" || !visible || dragging) return;
    const between = (min: number, max: number) => min + Math.random() * (max - min);
    const duration = action === "idle" ? between(PET_BEHAVIOR.idleMinMs, PET_BEHAVIOR.idleMaxMs)
      : action === "walk" ? between(PET_BEHAVIOR.walkMinMs, PET_BEHAVIOR.walkMaxMs)
      : action === "click" || action === "special" ? petActionDuration(pack, action) : PET_BEHAVIOR.specialMs;
    const timer = window.setTimeout(() => {
      if (action !== "idle") { setAction("idle"); return; }
      setAction(roaming && Math.random() < PET_BEHAVIOR.walkProbability ? "walk" : "special");
    }, duration);
    return () => window.clearTimeout(timer);
  }, [action, actionCycle, mode, visible, dragging, roaming, pack]);

  function handlePointerDown(event: PointerEvent<HTMLElement>): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClickRef.current = false;
    dragRef.current = { x: event.screenX, y: event.screenY, offsetX: event.clientX, offsetY: event.clientY, moved: false };
    window.paperHelper?.setPetDragging(true);
    setAction("idle");
    setDragging(true);
  }
  function handlePointerMove(event: PointerEvent<HTMLElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.hypot(event.screenX - drag.x, event.screenY - drag.y) > 4) drag.moved = true;
    if (drag.moved) window.paperHelper?.dragPetTo(event.screenX - drag.offsetX, event.screenY - drag.offsetY);
  }
  function endDrag(event: PointerEvent<HTMLElement>, cancelled = false): void {
    const drag = dragRef.current;
    if (!drag) return;
    suppressClickRef.current = cancelled || drag.moved;
    dragRef.current = null;
    window.paperHelper?.setPetDragging(false);
    setDragging(false);
    setActionCycle((value) => value + 1);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function handleClick(): void {
    if (suppressClickRef.current) return;
    if (mode === "ball") window.paperHelper?.showMain();
    else { setAction("click"); setActionCycle((value) => value + 1); window.paperHelper?.showPetTodos(); }
  }

  return (
    <main className={"desktop-pet-surface is-" + mode + " pack-" + pack + (visible ? "" : " is-paused")}
      style={{ "--pet-accent": packMeta.accent } as CSSProperties} data-action={action} data-direction={direction}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={(event) => endDrag(event)}
      onPointerCancel={(event) => endDrag(event, true)} onLostPointerCapture={(event) => endDrag(event, true)}
      onClick={handleClick}
      onContextMenu={(event) => { event.preventDefault(); window.paperHelper?.showPetMenu(); }}
      onDoubleClick={() => { if (!suppressClickRef.current) window.paperHelper?.showMain(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") window.paperHelper?.showMain();
        if (event.key === "Escape") window.paperHelper?.showPetMenu();
      }}
      tabIndex={0} role="application"
      title={mode === "ball" ? "拖动移动 · 单击打开学习台 · 右键切换角色" : "拖动只移动 · 单击互动与今日待办 · 双击打开学习台 · 右键调整大小"}
      aria-label={packMeta.label + (mode === "ball" ? "悬浮球" : "桌宠")}>
      {mode === "ball" ? (
        <div className="desktop-pet-ball" aria-hidden="true"><div className="desktop-pet-ball-avatar"><PetArtwork pack={pack} paused={!visible} /></div></div>
      ) : (
        <div className="desktop-pet-art" style={{ transform: "scaleX(" + petFacing(pack, direction) + ")" }} aria-hidden="true"><PetArtwork key={pack + action + actionCycle} pack={pack} action={action} paused={!visible} /></div>
      )}
    </main>
  );
}
