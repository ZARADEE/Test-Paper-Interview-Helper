import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, ChevronDown, Pause, Play, X } from 'lucide-react';
import { openTimer, OPEN_TIMER_PAPER, playAlarm, stopAlarm, timerCommand, useTimer } from '../timer/client';
import { activeSession, displaySeconds, modeLabels, timeLabel, validMinutes } from '../timer/model';
import type { PaperLink, TimerMode } from '../timer/model';
import '../timer/timer.css';
export function TimerSetup({ paper, title: initialTitle, minutes: initialMinutes, onStarted, onCancel }: {
    paper?: PaperLink;
    title?: string;
    minutes?: number;
    onStarted?: () => void;
    onCancel?: () => void;
}): JSX.Element {
    const state = useTimer(), [mode, setMode] = useState<TimerMode>('focus'), [title, setTitle] = useState(initialTitle ?? ''), [minutes, setMinutes] = useState(String(initialMinutes ?? state.preferences.durations.focus)), [destination, setDestination] = useState('main'), [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => { if (!paper)
        setMinutes(String(state.preferences.durations[mode])); }, [mode, state.preferences.durations.focus, state.preferences.durations.shortBreak, state.preferences.durations.longBreak, paper]);
    async function start() { setBusy(true); setError(''); try {
        await timerCommand({ type: 'start', mode, title: title.trim() || modeLabels[mode], minutes: Number(minutes), paper });
        if (destination !== 'main')
            window.paperHelper?.showAmbient(destination as 'pet' | 'ball');
        onStarted?.();
    }
    catch (e) {
        setError(String(e));
    }
    finally {
        setBusy(false);
    } }
    async function saveDuration() { if (!paper && validMinutes(Number(minutes)) && Number(minutes) !== state.preferences.durations[mode])
        try {
            await timerCommand({ type: 'preferences', preferences: { durations: { ...state.preferences.durations, [mode]: Number(minutes) } } });
        }
        catch (e) {
            setError(String(e));
        } }
    if (activeSession(state.session))
        return <div className="timer-existing">已有一轮正在计时。<button onClick={openTimer}>查看当前计时</button>{onCancel && <button onClick={onCancel}>取消</button>}</div>;
    return <div className="timer-setup">
  {!paper && <div className="timer-modes">{(Object.keys(modeLabels) as TimerMode[]).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{modeLabels[m]}</button>)}</div>}
  <div className="timer-fields"><label>本次名称<input aria-label="本次计时名称" maxLength={200} placeholder={modeLabels[mode]} value={title} onChange={e => setTitle(e.target.value)}/></label><label>时长（分钟）<input aria-label="计时时长" type="number" min={1} max={1440} step={1} value={minutes} onChange={e => setMinutes(e.target.value)}/></label></div>
  {!paper && <button className="timer-link" disabled={!validMinutes(Number(minutes)) || Number(minutes) === state.preferences.durations[mode]} onClick={() => void saveDuration()}>设为此模式默认时长</button>}
  <SoundSettings />
  <div className="timer-actions">{window.paperHelper && <select aria-label="开始后的显示形态" value={destination} onChange={e => setDestination(e.target.value)}><option value="main">留在学习台</option><option value="pet">进入桌宠</option><option value="ball">进入悬浮球</option></select>}<button className="timer-primary" disabled={busy || !validMinutes(Number(minutes))} onClick={() => void start()}><Play size={16}/>{busy ? '正在开始…' : '开始计时'}</button>{onCancel && <button onClick={onCancel}>取消</button>}</div>
  {!validMinutes(Number(minutes)) && <p role="alert">请输入 1–1440 的整数分钟。</p>}{error && <p className="timer-error" role="alert">{error}</p>}
 </div>;
}
export function SoundSettings(): JSX.Element {
    const s = useTimer(), [error, setError] = useState(''), [volume, setVolume] = useState(s.preferences.volume);
    useEffect(() => setVolume(s.preferences.volume), [s.preferences.volume]);
    async function set(p: {
        sound?: boolean;
        volume?: number;
    }) { try {
        await timerCommand({ type: 'preferences', preferences: p });
        setError('');
    }
    catch (e) {
        setError(String(e));
    } }
    return <div className="timer-sound-settings"><label><input type="checkbox" checked={s.preferences.sound} onChange={e => void set({ sound: e.target.checked })}/>到点提示音</label><input type="range" aria-label="提示音音量" min={0} max={1} step={.05} value={volume} onChange={e => setVolume(Number(e.target.value))} onPointerUp={() => void set({ volume })} onKeyUp={() => void set({ volume })}/><button onClick={() => { if (window.paperHelper)
        window.paperHelper.previewTimerSound(volume);
    else
        void playAlarm(volume); }}>试听</button>{(error || s.soundError) && <small role="alert">{error || s.soundError}</small>}</div>;
}
function expectedAt(now: number, remaining: number): string { const date = new Date(now + remaining), today = new Date(now); const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); return (date.toDateString() === today.toDateString() ? '' : date.toLocaleDateString('zh-CN') + ' ') + time; }
export function TimerCard({ ambient = false, compact = false, onExpanded }: {
    ambient?: boolean;
    compact?: boolean;
    onExpanded?: (value: boolean) => void;
}): JSX.Element {
    const st = useTimer(), s = st.session, [expanded, setExpanded] = useState(!compact), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const root = useRef<HTMLElement>(null);
    const change = (v: boolean) => { setExpanded(v); onExpanded?.(v); };
    useEffect(() => { setConfirm(false); setError(''); }, [s?.id]);
    useEffect(() => { if (s?.status === 'overtime' && !s.dismissed)
        change(true); if (s?.status === 'ended' && !s.resultHidden)
        change(true); }, [s?.id, s?.status, s?.dismissed, s?.resultHidden]);
    useEffect(() => { if (!compact)
        return; const close = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node))
        void collapse(); }; document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close); });
    useEffect(() => { if (ambient)
        return window.paperHelper?.onTimerCollapse(() => void collapse()); });
    async function action(type: 'pause' | 'resume' | 'end' | 'dismiss' | 'hideResult' | 'recover') { setBusy(true); setError(''); try {
        await timerCommand({ type }, s?.id);
        setConfirm(false);
    }
    catch (e) {
        setError(String(e));
    }
    finally {
        setBusy(false);
    } }
    async function collapse() { stopAlarm(); if (s?.status === 'overtime' && !s.dismissed)
        await action('dismiss'); if (s?.status === 'ended' && !s.resultHidden)
        await action('hideResult'); change(false); setConfirm(false); }
    async function next(mode: TimerMode) { if (!s)
        return; setBusy(true); try {
        await timerCommand({ type: 'start', mode, title: mode === s.mode ? s.title : modeLabels[mode], minutes: mode === s.mode ? s.plannedMs / 60000 : st.preferences.durations[mode], paper: mode === s.mode ? s.paper : undefined });
    }
    catch (e) {
        setError(String(e));
    }
    finally {
        setBusy(false);
    } }
    const ended = s?.status === 'ended', over = !!s && s.elapsedMs >= s.plannedMs && !ended;
    const label = !s ? '尚未开始' : ended ? '本次已结束' : s.clockIssue ? '时间需要核对' : s.status === 'paused' ? '已暂停' : over ? (s.mode === 'focus' ? '已超时' : '休息已超时') : '剩余';
    const drag = useRef<{
        x: number;
        y: number;
        px: number;
        py: number;
    } | null>(null);
    if (!s)
        return <section className="timer-card" data-status="idle">{!compact && <><TimerSetup />{st.saveError && <p className="timer-error" role="alert">{st.saveError}</p>}</>}</section>;
    if (ambient && ended && s.resultHidden)
        return <section className="timer-card timer-empty"/>;
    return <section ref={root} className={'timer-card' + (over ? ' is-overtime' : '') + (s.status === 'paused' ? ' is-paused' : '') + (compact ? ' is-compact' : '') + (expanded ? ' is-expanded' : '')} data-status={s.status} onKeyDown={e => { if (e.key === 'Escape' && compact)
        void collapse(); }}>
  <header className="timer-heading" onPointerDown={e => { if (!ambient || e.button !== 0 || (e.target as HTMLElement).closest('button'))
        return; drag.current = { x: e.screenX, y: e.screenY, px: 0, py: 0 }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { const d = drag.current; if (!d)
        return; const x = e.screenX - d.x, y = e.screenY - d.y; if (Math.hypot(x, y) > 4) {
        window.paperHelper?.dragTimerBy(x - d.px, y - d.py);
        d.px = x;
        d.py = y;
    } }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
   <span title={s.title}>{s.title}</span><button title={st.preferences.sound ? '关闭到点提示音' : '开启到点提示音'} aria-label={st.preferences.sound ? '关闭到点提示音' : '开启到点提示音'} onClick={() => void timerCommand({ type: 'preferences', preferences: { sound: !st.preferences.sound } }).catch(e => setError(String(e)))}>{st.preferences.sound ? <Bell size={16}/> : <BellOff size={16}/>}</button>{compact && expanded && <button aria-label="收起计时面板" onClick={() => void collapse()}><X size={16}/></button>}
  </header>
  <div className="timer-clock-row"><button className="timer-clock" aria-label={expanded ? '收起计时控制' : '展开计时控制'} onClick={() => compact && (expanded ? void collapse() : change(true))}><span role="status">{label}</span><strong>{timeLabel(s)}</strong></button>{compact && !expanded && over && <button className="timer-primary" disabled={busy} onClick={() => void action('end')}>结束本次</button>}{compact && !expanded && !over && <button aria-label="展开计时控制" onClick={() => change(true)}><ChevronDown size={18}/></button>}</div>
  {!ended && s.status === 'running' && !s.clockIssue && <small className="timer-expected">预计 {expectedAt(st.now, Math.max(0, s.plannedMs - s.elapsedMs))} 到点</small>}
  {(expanded || !compact) && <>
   <div className="timer-progress"><i style={{ width: Math.min(100, s.elapsedMs / s.plannedMs * 100) + '%' }}/></div>
   <dl className="timer-metrics"><div><dt>计划</dt><dd>{displaySeconds(s.plannedMs)}</dd></div><div><dt>计时用时</dt><dd>{displaySeconds(s.elapsedMs)}</dd></div><div><dt>暂停</dt><dd>{displaySeconds(s.pausedMs)}</dd></div><div><dt>{s.elapsedMs >= s.plannedMs ? '超时' : '剩余'}</dt><dd>{displaySeconds(Math.abs(s.elapsedMs - s.plannedMs))}</dd></div></dl>
   {s.notice && <p className="timer-notice">{s.notice}</p>}
   <div className="timer-actions">
    {!ended && s.clockIssue && <button disabled={busy} onClick={() => void action('recover')}>从可靠用时继续</button>}
    {!ended && !s.clockIssue && !over && <button disabled={busy} onClick={() => void action(s.status === 'paused' ? 'resume' : 'pause')}>{s.status === 'paused' ? <Play size={16}/> : <Pause size={16}/>} {s.status === 'paused' ? '继续' : '暂停'}</button>}
    {!ended && <button className="timer-primary" disabled={busy} onClick={() => over ? void action('end') : setConfirm(true)}>{over ? '结束本次' : '提前结束'}</button>}
    {over && <button onClick={() => void collapse()}>收起提醒</button>}
    {ended && <><button disabled={busy} onClick={() => void next(s.mode)}>再来一轮</button>{s.mode === 'focus' && <button disabled={busy} onClick={() => void next('shortBreak')}>开始短休</button>}{s.paper && <button onClick={() => { if (ambient)
            window.paperHelper?.openTimerPaper(s.paper!);
        else
            window.dispatchEvent(new CustomEvent(OPEN_TIMER_PAPER, { detail: s.paper })); }}>查看本卷</button>}</>}
   </div>
   {confirm && !ended && <div className="timer-confirm" role="group" aria-label="确认结束计时"><p>{over ? '已到点，结束本次？' : '现在结束并保存本次用时？'}</p><button className="timer-primary" disabled={busy} onClick={() => void action('end')}>确认结束</button><button onClick={() => setConfirm(false)}>继续计时</button></div>}
   {over && <small>收起后仍会继续记录超时。</small>}
   {ended && <><p>{s.elapsedMs < s.plannedMs ? '本次提前结束' : '本次已达到计划时长'} · 已完成专注 {st.completedRounds} 轮</p><details><summary>起止时间与总经过</summary><p>{new Date(s.startedAt).toLocaleString()} → {new Date(s.endedAt!).toLocaleString()}</p><p>总经过 {displaySeconds(s.elapsedMs + s.pausedMs)}</p></details></>}
   {!compact && <SoundSettings />}
  </>}
  {(error || st.saveError || st.soundError) && <p className="timer-error" role="alert">{error || st.saveError || st.soundError}</p>}
  {!compact && ended && <details className="timer-new"><summary>设置下一轮</summary><TimerSetup /></details>}
 </section>;
}
export function AmbientTimer(): JSX.Element { const root = useRef<HTMLDivElement>(null); useEffect(() => { if (!root.current)
    return; const observer = new ResizeObserver(() => window.paperHelper?.resizeTimer(Math.ceil(root.current!.scrollHeight))); observer.observe(root.current); return () => observer.disconnect(); }, []); return <div ref={root} className="ambient-timer"><TimerCard ambient compact onExpanded={expanded => window.paperHelper?.expandTimer(expanded)}/></div>; }
export function TimerDock({ home }: {
    home: boolean;
}): JSX.Element | null { const s = useTimer(), [homeVisible, setHomeVisible] = useState(home); useEffect(() => { if (!home) {
    setHomeVisible(false);
    return;
} const target = document.querySelector('.home-pomodoro'); if (!target)
    return; const observer = new IntersectionObserver(entries => setHomeVisible(entries[0].intersectionRatio > .35), { threshold: [0, .35, 1] }); observer.observe(target); return () => observer.disconnect(); }, [home, s.session?.id]); if ((home && homeVisible) || !s.session || (s.session.status === 'ended' && s.session.resultHidden))
    return null; return <aside className="timer-dock"><TimerCard compact/><button className="timer-link" onClick={openTimer}>打开番茄钟</button></aside>; }
