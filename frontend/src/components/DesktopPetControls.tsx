import { Check, Circle, Monitor, PawPrint } from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_PET_PACK, PET_PACKS, PET_SIZES, isPetPack } from "../petConfig";
import type { PetPackId, PetSettings, PetSize } from "../petConfig";
import { PetArtwork } from "./DesktopPetView";

export function DesktopPetControls(): JSX.Element {
  const [pack, setPack] = useState<PetPackId>(DEFAULT_PET_PACK);
  const [size, setSize] = useState<PetSize>(220);
  const [roaming, setRoaming] = useState(true);
  const desktopAvailable = Boolean(window.paperHelper);
  useEffect(() => {
    let active = true;
    const applySettings = (settings: PetSettings) => {
      if (!active) return;
      if (isPetPack(settings.pack)) setPack(settings.pack);
      setSize(settings.size); setRoaming(settings.roaming);
    };
    void window.paperHelper?.getPetSettings().then(applySettings).catch(() => {});
    const remove = window.paperHelper?.onPetSurface(applySettings);
    return () => { active = false; remove?.(); };
  }, []);
  return (
    <section className="home-ambient-bar panel" aria-labelledby="desktop-companion-heading">
      <header className="home-ambient-heading">
        <div className="home-panel-title">
          <span className="home-panel-icon" aria-hidden="true"><PawPrint size={18} /></span>
          <h2 id="desktop-companion-heading">桌面陪伴</h2>
        </div>
        <p>{desktopAvailable ? "选好角色，关闭主窗口后继续陪伴。" : "预览你的桌面伙伴，在桌面客户端开启陪伴。"}</p>
      </header>
      <div className="home-ambient-body">
        <div className="home-pet-packs" role="group" aria-label="选择桌宠角色">
          {PET_PACKS.map((item) => (
            <button key={item.id} type="button" className={"home-pet-choice" + (pack === item.id ? " is-selected" : "")} aria-pressed={pack === item.id}
              onClick={() => { setPack(item.id); window.paperHelper?.setPetPack(item.id); }}>
              <div className="home-pet-preview"><PetArtwork pack={item.id} /></div>
              <span className="home-pet-name">{item.label}</span>
              {pack === item.id && <span className="home-pet-selected" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>}
            </button>
          ))}
        </div>
        <div className="home-ambient-tools">
          <div className="home-pet-settings">
            <label>大小 <select aria-label="桌宠大小" value={size} disabled={!desktopAvailable} onChange={(event) => {
              const next = Number(event.target.value) as PetSize; setSize(next); window.paperHelper?.setPetSize(next);
            }}>{PET_SIZES.map((value, index) => <option key={value} value={value}>{["小", "中", "大"][index]}</option>)}</select></label>
            <label title="在桌面自由移动，碰到边缘自动反弹"><input type="checkbox" checked={roaming} disabled={!desktopAvailable} onChange={(event) => {
              setRoaming(event.target.checked); window.paperHelper?.setPetRoaming(event.target.checked);
            }} /> 自动漫游</label>
          </div>
          <div className="home-ambient-actions">
            <button type="button" className="primary-action compact" disabled={!desktopAvailable} onClick={() => window.paperHelper?.showAmbient("pet")}><Monitor size={16} />开启桌宠</button>
            <button type="button" className="outline-action" disabled={!desktopAvailable} onClick={() => window.paperHelper?.showAmbient("ball")}><Circle size={16} />悬浮球</button>
          </div>
        </div>
      </div>
    </section>
  );
}
