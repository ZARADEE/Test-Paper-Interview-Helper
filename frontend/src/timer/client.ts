import { useEffect, useSyncExternalStore } from 'react';
import { TimerEngine, initialState, readState } from './model';
import type { TimerCommand, TimerReply, TimerSnapshot } from './model';
const KEY = 'paper-helper.timer.v1';
export const OPEN_TIMER = 'paper-helper:open-timer';
export const OPEN_TIMER_PAPER = 'paper-helper:timer-paper';
let snapshot: TimerSnapshot = { ...initialState(), now: Date.now() };
let initialized = false;
const listeners = new Set<() => void>();
let audio: HTMLAudioElement | null = null;
let localSoundError: string | undefined;
function emit(s: TimerSnapshot): void { snapshot = { ...s, soundError: window.paperHelper ? s.soundError : localSoundError }; listeners.forEach(f => f()); }
function acceptBrowserState(s: TimerSnapshot): void {
    const previous = snapshot.session, current = s.session;
    const stop = (snapshot.preferences.sound && !s.preferences.sound) ||
        (!!previous && previous.id !== current?.id) ||
        (!!previous && !!current && previous.id === current.id &&
            ((previous.status !== 'ended' && current.status === 'ended') || (!previous.dismissed && current.dismissed)));
    emit(s);
    if (stop)
        stopAlarm();
}
export function stopAlarm(): void { if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio = null;
} }
export async function playAlarm(volume: number): Promise<void> {
    stopAlarm();
    const current = new Audio(new URL('./assets/timer-alarm.wav', document.baseURI).href);
    audio = current;
    current.volume = volume;
    try {
        await current.play();
        if (audio !== current)
            return;
        localSoundError = undefined;
        emit({ ...snapshot, soundError: undefined });
        window.paperHelper?.reportTimerSound(false);
    }
    catch {
        if (audio !== current)
            return;
        localSoundError = '提示音无法播放，请点击试听检查；视觉提醒和计时仍有效。';
        emit({ ...snapshot, soundError: localSoundError });
        window.paperHelper?.reportTimerSound(true);
    }
}
function legacy(key: string): unknown { try {
    return JSON.parse(localStorage.getItem(key) || 'null');
}
catch {
    return null;
} }
function browserEngine(): TimerEngine { const raw = localStorage.getItem(KEY); const e = new TimerEngine(raw ? readState(JSON.parse(raw)) : initialState()); e.migrate(legacy('paper-helper.home.pomodoro.v2'), legacy('paper-helper.home.pomodoro-durations.v1'), Date.now(), () => crypto.randomUUID()); return e; }
async function browserWork(c?: TimerCommand): Promise<TimerReply> {
    const work = async () => {
        try {
            const e = browserEngine();
            e.tick(Date.now());
            let error: string | undefined;
            if (c)
                try {
                    e.command(c, Date.now(), () => crypto.randomUUID());
                }
                catch (x) {
                    error = String(x instanceof Error ? x.message : x);
                }
            const alarm = e.claimAlarm();
            localStorage.setItem(KEY, JSON.stringify(e.state));
            const s = e.snapshot(Date.now());
            acceptBrowserState(s);
            if (alarm && s.preferences.sound)
                void playAlarm(s.preferences.volume);
            return { snapshot: s, error };
        }
        catch (e) {
            const error = '计时记录无法保存或读取，请检查浏览器存储：' + String(e);
            emit({ ...snapshot, saveError: error });
            return { snapshot, error };
        }
    };
    if (!navigator.locks) {
        const error = '此浏览器无法安全协调多标签计时，请使用桌面端或支持 Web Locks 的浏览器。';
        emit({ ...snapshot, saveError: error });
        return { snapshot, error };
    }
    return navigator.locks.request(KEY, work);
}
function initialize(): void {
    if (initialized)
        return;
    initialized = true;
    if (window.paperHelper) {
        window.paperHelper.onTimerState(emit);
        const surface = new URLSearchParams(location.search).get('surface');
        if (surface === 'timer')
            window.paperHelper.onTimerSound(action => { if (action.play)
                void playAlarm(action.volume);
            else
                stopAlarm(); });
        void window.paperHelper.getTimer().then(emit);
        if (!surface)
            void window.paperHelper.migrateTimer(legacy('paper-helper.home.pomodoro.v2'), legacy('paper-helper.home.pomodoro-durations.v1')).then(emit);
    }
    else {
        void browserWork();
        setInterval(() => void browserWork(), 500);
        window.addEventListener('storage', e => { if (e.key === KEY && e.newValue)
            try {
                const s = readState(JSON.parse(e.newValue));
                acceptBrowserState({ ...s, now: Date.now() });
            }
            catch { /* Preserve current display until next storage check. */ } });
    }
}
export function useTimer(): TimerSnapshot { useEffect(initialize, []); return useSyncExternalStore(f => { listeners.add(f); return () => listeners.delete(f); }, () => snapshot); }
export async function timerCommand(input: Omit<TimerCommand, 'requestId' | 'revision' | 'sessionId'>, expectedSessionId?: string): Promise<TimerSnapshot> {
    initialize();
    if (expectedSessionId && snapshot.session?.id !== expectedSessionId)
        throw new Error('这轮计时已变化，请按当前状态操作。');
    const c: TimerCommand = { ...input, requestId: crypto.randomUUID(), revision: snapshot.revision, sessionId: expectedSessionId ?? snapshot.session?.id };
    const r = window.paperHelper ? await window.paperHelper.timerCommand(c) : await browserWork(c);
    emit(r.snapshot);
    if (r.error)
        throw new Error(r.error);
    return r.snapshot;
}
export function openTimer(): void { if (new URLSearchParams(location.search).get('surface'))
    window.paperHelper?.openTimer();
else
    window.dispatchEvent(new Event(OPEN_TIMER)); }
