import { useEffect, useRef, useState } from "react";
import type { AgentSettings } from "../types";

// Deliberately memory-only: changing tabs must never write credentials to disk.
let sessionSettings: AgentSettings | undefined;
export const getAgentSettings = (): AgentSettings | undefined => sessionSettings;

export function AgentDialog({ onConfirm, onClose }: { onConfirm: (settings: AgentSettings) => void; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<AgentSettings>(sessionSettings ?? { api_key: "", base_url: "", model: "", instructions: "" });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return <dialog ref={ref} className="agent-dialog" onCancel={onClose} aria-labelledby="agent-title">
    <form onSubmit={(event) => { event.preventDefault(); sessionSettings = { ...settings, api_key: settings.api_key.trim(), model: settings.model.trim(), base_url: settings.base_url.trim().replace(/\/$/, "") }; onConfirm(sessionSettings); }}>
      <div className="section-kicker">AGENT / CONNECTION</div>
      <h2 id="agent-title">配置 Agent 组卷</h2>
      <p>填写兼容 Chat Completions 的模型服务。开启后，候选题目的标签、知识点和你的组卷要求将发送到此服务，可能产生调用费用。</p>
      <label><span>API 地址（包含版本路径，例如 /v1）</span><input autoFocus required type="url" pattern="https://.*" placeholder="https://你的模型服务/v1" value={settings.base_url} onChange={e => setSettings({ ...settings, base_url: e.target.value })} /></label>
      <label><span>模型名称</span><input required value={settings.model} onChange={e => setSettings({ ...settings, model: e.target.value })} /></label>
      <label><span>API Key</span><input required type="password" autoComplete="off" value={settings.api_key} onChange={e => setSettings({ ...settings, api_key: e.target.value })} /></label>
      <label><span>组卷要求（可选）</span><textarea maxLength={2000} placeholder="例如：优先覆盖基础知识，避免知识点重复。" value={settings.instructions} onChange={e => setSettings({ ...settings, instructions: e.target.value })} /></label>
      <p className="muted-copy">密钥仅保留在本次应用会话内，不写入模板、浏览器存储或数据库。关闭应用后需重新填写。</p>
      <div className="toolbar-actions"><button type="button" onClick={onClose}>取消</button><button className="primary-action compact" type="submit">确认配置</button></div>
    </form>
  </dialog>;
}
