export type TimerMode = 'focus' | 'shortBreak' | 'longBreak';
export const modeLabels: Record<TimerMode, string> = { focus: '专注', shortBreak: '短休', longBreak: '长休' };
export type PaperLink = {
    id: string;
    version?: string;
};
export type TimerSession = {
    id: string;
    mode: TimerMode;
    title: string;
    plannedMs: number;
    status: 'running' | 'paused' | 'overtime' | 'ended';
    startedAt: number;
    checkpointAt: number;
    elapsedMs: number;
    pausedMs: number;
    endedAt?: number;
    alerted: boolean;
    dismissed: boolean;
    resultHidden: boolean;
    paper?: PaperLink;
    notice?: string;
    clockIssue?: boolean;
};
export type TimerState = {
    schemaVersion: 1;
    revision: number;
    migrated: boolean;
    completedRounds: number;
    preferences: {
        durations: Record<TimerMode, number>;
        sound: boolean;
        volume: number;
    };
    session: TimerSession | null;
    history: TimerSession[];
    recentRequests: string[];
};
export type TimerSnapshot = TimerState & {
    now: number;
    saveError?: string;
    soundError?: string;
};
export type TimerCommand = {
    type: 'start' | 'pause' | 'resume' | 'end' | 'dismiss' | 'hideResult' | 'preferences' | 'recover';
    requestId: string;
    revision: number;
    sessionId?: string;
    mode?: TimerMode;
    minutes?: number;
    title?: string;
    paper?: PaperLink;
    preferences?: Partial<TimerState['preferences']>;
};
export type TimerReply = {
    snapshot: TimerSnapshot;
    error?: string;
};
export const activeSession = (s: TimerSession | null | undefined): s is TimerSession & {
    status: 'running' | 'paused' | 'overtime';
} => !!s && s.status !== 'ended';
export function initialState(): TimerState { return { schemaVersion: 1, revision: 0, migrated: false, completedRounds: 0, preferences: { durations: { focus: 25, shortBreak: 5, longBreak: 15 }, sound: true, volume: .45 }, session: null, history: [], recentRequests: [] }; }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const validMinutes = (n: unknown): n is number => finite(n) && Number.isInteger(n) && n >= 1 && n <= 1440;
function validSession(s: TimerSession): boolean { return !!s && typeof s.id === 'string' && !!s.id && typeof s.title === 'string' && s.title.length <= 200 && Object.hasOwn(modeLabels, s.mode) && ['running', 'paused', 'overtime', 'ended'].includes(s.status) && finite(s.plannedMs) && validMinutes(s.plannedMs / 60000) && [s.startedAt, s.checkpointAt, s.elapsedMs, s.pausedMs].every(n => finite(n) && n >= 0) && ['alerted', 'dismissed', 'resultHidden'].every(k => typeof s[k as keyof TimerSession] === 'boolean') && (s.status !== 'ended' || finite(s.endedAt)) && (s.notice === undefined || typeof s.notice === 'string') && (s.clockIssue === undefined || typeof s.clockIssue === 'boolean') && (!s.paper || (typeof s.paper.id === 'string' && (s.paper.version === undefined || typeof s.paper.version === 'string'))); }
export function readState(value: unknown): TimerState { const s = value as TimerState; if (!s || s.schemaVersion !== 1 || !Number.isInteger(s.revision) || s.revision < 0 || typeof s.migrated !== 'boolean' || !Number.isInteger(s.completedRounds) || s.completedRounds < 0 || !s.preferences || !(['focus', 'shortBreak', 'longBreak'] as const).every(m => validMinutes(s.preferences.durations?.[m])) || typeof s.preferences.sound !== 'boolean' || !finite(s.preferences.volume) || s.preferences.volume < 0 || s.preferences.volume > 1 || (s.session !== null && !validSession(s.session)) || !Array.isArray(s.history) || !s.history.every(h => validSession(h) && h.status === 'ended') || !Array.isArray(s.recentRequests) || !s.recentRequests.every(r => typeof r === 'string'))
    throw new Error('计时记录格式异常，请保留原文件后恢复。'); return structuredClone(s); }
export class TimerEngine {
    state: TimerState;
    constructor(state: TimerState = initialState()) { this.state = readState(state); }
    tick(now: number): boolean {
        const s = this.state.session;
        if (!activeSession(s) || s.clockIssue)
            return false;
        const delta = now - s.checkpointAt;
        if (delta < -1000) {
            s.clockIssue = true;
            s.notice = '系统时间变化，本次需要核对。可从最后可靠用时继续，或结束并保留异常标记。';
            this.state.revision++;
            return false;
        }
        if (s.status === 'paused')
            s.pausedMs += Math.max(0, delta);
        else
            s.elapsedMs += Math.max(0, delta);
        s.checkpointAt = Math.max(now, s.checkpointAt);
        if (s.status === 'running' && s.elapsedMs >= s.plannedMs) {
            s.status = 'overtime';
            this.state.revision++;
            return true;
        }
        return false;
    }
    claimAlarm(): boolean { const s = this.state.session; if (!s || s.status !== 'overtime' || s.alerted || s.clockIssue)
        return false; s.alerted = true; this.state.revision++; return true; }
    command(c: TimerCommand, now: number, newId: () => string): void {
        if (!c || typeof c.requestId !== 'string' || !c.requestId || c.requestId.length > 120)
            throw new Error('无效计时请求。');
        this.tick(now);
        if (this.state.recentRequests.includes(c.requestId))
            return;
        const s = this.state.session;
        if (c.type === 'end' && c.sessionId && this.state.history.some(h => h.id === c.sessionId))
            return;
        if (c.revision !== this.state.revision)
            throw new Error('计时状态已更新，请按当前状态重新操作。');
        if (c.type === 'start') {
            if (activeSession(s))
                throw new Error('已有一轮正在计时，请先结束本次。');
            if (!c.mode || !Object.hasOwn(modeLabels, c.mode) || !validMinutes(c.minutes))
                throw new Error('时长须为 1–1440 的整数分钟。');
            if (c.paper && (typeof c.paper.id !== 'string' || c.paper.id.length > 150 || (c.paper.version !== undefined && (typeof c.paper.version !== 'string' || c.paper.version.length > 100))))
                throw new Error('试卷关联无效。');
            this.state.migrated = true;
            this.state.session = { id: newId(), mode: c.mode, title: String(c.title || modeLabels[c.mode]).trim().slice(0, 200) || modeLabels[c.mode], plannedMs: c.minutes * 60000, status: 'running', startedAt: now, checkpointAt: now, elapsedMs: 0, pausedMs: 0, alerted: false, dismissed: false, resultHidden: false, paper: c.paper };
        }
        else if (c.type === 'preferences') {
            const p = c.preferences;
            if (!p || (p.volume !== undefined && (!finite(p.volume) || p.volume < 0 || p.volume > 1)) || (p.sound !== undefined && typeof p.sound !== 'boolean'))
                throw new Error('提醒设置无效。');
            if (p.durations) {
                if (activeSession(s))
                    throw new Error('请结束本轮后再修改默认时长。');
                if (!(['focus', 'shortBreak', 'longBreak'] as const).every(m => validMinutes(p.durations![m])))
                    throw new Error('时长须为 1–1440 的整数分钟。');
                this.state.preferences.durations = { ...p.durations };
            }
            if (p.volume !== undefined)
                this.state.preferences.volume = p.volume;
            if (p.sound !== undefined)
                this.state.preferences.sound = p.sound;
        }
        else {
            if (!s || c.sessionId !== s.id)
                throw new Error('这轮计时已变化，请刷新后操作。');
            if (c.type === 'pause') {
                if (s.status !== 'running' || s.clockIssue)
                    throw new Error('已到点或已暂停，请按当前状态操作。');
                s.status = 'paused';
            }
            else if (c.type === 'resume') {
                if (s.status !== 'paused' || s.clockIssue)
                    throw new Error('当前不能继续，请核对计时状态。');
                s.status = 'running';
            }
            else if (c.type === 'recover') {
                if (!s.clockIssue || s.status === 'ended')
                    throw new Error('当前不需要恢复。');
                s.clockIssue = false;
                s.checkpointAt = now;
                s.notice = '系统时间曾变化，已从最后可靠用时继续。';
            }
            else if (c.type === 'end') {
                if (s.status === 'ended')
                    return;
                s.status = 'ended';
                s.endedAt = now;
                s.checkpointAt = now;
                if (s.mode === 'focus' && s.elapsedMs >= s.plannedMs)
                    this.state.completedRounds++;
                this.state.history.push(structuredClone(s));
            }
            else if (c.type === 'dismiss')
                s.dismissed = true;
            else if (c.type === 'hideResult') {
                if (s.status !== 'ended')
                    throw new Error('计时尚未结束。');
                s.resultHidden = true;
            }
            else
                throw new Error('未知计时操作。');
        }
        this.state.revision++;
        this.state.recentRequests = [...this.state.recentRequests.slice(-99), c.requestId];
    }
    migrate(raw: unknown, durations: unknown, now: number, newId: () => string): void {
        if (this.state.migrated || this.state.session)
            return;
        const d = durations as Record<TimerMode, unknown> | null;
        for (const m of ['focus', 'shortBreak', 'longBreak'] as const)
            if (validMinutes(d?.[m]))
                this.state.preferences.durations[m] = d![m] as number;
        const old = raw as {
            mode?: TimerMode;
            remainingSeconds?: number;
            running?: boolean;
            completedRounds?: number;
            updatedAt?: number;
        } | null;
        if (old) {
            this.state.completedRounds = finite(old.completedRounds) ? Math.max(0, Math.floor(old.completedRounds)) : 0;
            const mode = old.mode && Object.hasOwn(modeLabels, old.mode) ? old.mode : 'focus';
            const total = this.state.preferences.durations[mode] * 60000;
            const remaining = finite(old.remainingSeconds) ? Math.max(0, old.remainingSeconds * 1000) : total;
            if (old.running || (remaining > 0 && remaining < total)) {
                const at = finite(old.updatedAt) ? old.updatedAt : now;
                this.state.session = { id: newId(), title: modeLabels[mode], mode, plannedMs: total, status: old.running ? 'running' : 'paused', startedAt: Math.max(0, at - Math.max(0, total - remaining)), checkpointAt: at, elapsedMs: Math.max(0, total - remaining), pausedMs: 0, alerted: false, dismissed: false, resultHidden: false, notice: '从旧计时恢复；旧版本未保存完整起止和暂停历史。' };
                this.tick(now);
            }
        }
        this.state.migrated = true;
        this.state.revision++;
    }
    snapshot(now: number, saveError?: string): TimerSnapshot { return { ...structuredClone(this.state), now, saveError }; }
}
export function displaySeconds(ms: number, ceil = false): string { const secs = Math.max(0, (ceil ? Math.ceil : Math.floor)(ms / 1000)); const pad = (n: number) => String(n).padStart(2, '0'); return secs >= 3600 ? Math.floor(secs / 3600) + ':' + pad(Math.floor(secs % 3600 / 60)) + ':' + pad(secs % 60) : pad(Math.floor(secs / 60)) + ':' + pad(secs % 60); }
export function timeLabel(s: TimerSession): string { return s.status === 'ended' ? displaySeconds(s.elapsedMs) : s.elapsedMs >= s.plannedMs ? '+' + displaySeconds(s.elapsedMs - s.plannedMs) : displaySeconds(s.plannedMs - s.elapsedMs, true); }
