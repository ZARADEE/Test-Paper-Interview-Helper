import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TimerEngine, activeSession, readState } from '../src/timer/model';
import type { TimerCommand, TimerReply, TimerSnapshot } from '../src/timer/model';
export class TimerService {
    engine = new TimerEngine();
    private saveError = '';
    soundError: string | undefined;
    private blocked = false;
    private mono = performance.now();
    private sleepAt: number | null = null;
    private checkpoint = 0;
    private ticker: ReturnType<typeof setInterval>;
    constructor(private path: string, private changed: (s: TimerSnapshot) => void, private alarm: (s: TimerSnapshot) => void, private stopSound: () => void) {
        if (existsSync(path)) {
            try {
                this.engine = new TimerEngine(readState(JSON.parse(readFileSync(path, 'utf8'))));
            }
            catch {
                this.blocked = true;
                this.saveError = '计时文件损坏，原文件已保留。请检查用户目录中的 focus-timer.json 后重新启动。';
            }
        }
        if (activeSession(this.engine.state.session)) {
            this.engine.tick(Date.now());
            const s = this.engine.state.session;
            if (!s.notice)
                s.notice = s.status === 'paused' ? '已恢复暂停的计时。' : '已恢复未结束计时，包含应用关闭期间。';
        }
        this.ticker = setInterval(() => this.tick(), 250);
    }
    snapshot(): TimerSnapshot { return { ...this.engine.snapshot(Date.now(), this.saveError || undefined), soundError: this.soundError }; }
    private persist(): boolean {
        if (this.blocked)
            return false;
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            writeFileSync(this.path + '.tmp', JSON.stringify(this.engine.state), 'utf8');
            if (existsSync(this.path))
                copyFileSync(this.path, this.path + '.bak');
            renameSync(this.path + '.tmp', this.path);
            this.saveError = '';
            this.checkpoint = Date.now();
            return true;
        }
        catch {
            this.saveError = '本次尚未保存，请检查磁盘空间和计时文件权限，修复后重试操作。';
            return false;
        }
    }
    tick(): void {
        const m = performance.now(), s = this.engine.state.session;
        if (activeSession(s) && !s.clockIssue && this.sleepAt === null) {
            this.engine.tick(s.checkpointAt + Math.max(0, m - this.mono));
            s.checkpointAt = Date.now();
        }
        this.mono = m;
        if (this.engine.claimAlarm()) {
            this.persist();
            this.changed(this.snapshot());
            this.alarm(this.snapshot());
        }
        if (Date.now() - this.checkpoint > 5000 && activeSession(s))
            this.persist();
        this.changed(this.snapshot());
    }
    command(c: TimerCommand): TimerReply {
        this.tick();
        const before = structuredClone(this.engine.state);
        try {
            if (this.blocked)
                throw new Error(this.saveError);
            this.engine.command(c, Date.now(), randomUUID);
            if (!this.persist()) {
                this.engine.state = before;
                throw new Error(this.saveError);
            }
            if (this.engine.state.revision !== before.revision && (c.type === 'end' || c.type === 'dismiss' || (c.type === 'preferences' && c.preferences?.sound === false)))
                this.stopSound();
            this.changed(this.snapshot());
            return { snapshot: this.snapshot() };
        }
        catch (e) {
            this.changed(this.snapshot());
            return { snapshot: this.snapshot(), error: e instanceof Error ? e.message : String(e) };
        }
    }
    migrate(raw: unknown, durations: unknown): TimerSnapshot {
        if (!this.blocked && !this.engine.state.migrated) {
            const before = structuredClone(this.engine.state);
            this.engine.migrate(raw, durations, Date.now(), randomUUID);
            if (!this.persist())
                this.engine.state = before;
            this.tick();
        }
        return this.snapshot();
    }
    suspend(): void { this.tick(); this.sleepAt = Date.now(); this.persist(); }
    resume(): void {
        const s = this.engine.state.session;
        if (this.sleepAt !== null && activeSession(s)) {
            this.engine.tick(s.checkpointAt + Date.now() - this.sleepAt);
            if (!s.clockIssue)
                s.checkpointAt = Date.now();
        }
        this.sleepAt = null;
        this.mono = performance.now();
        this.tick();
        this.persist();
    }
    close(): void { clearInterval(this.ticker); this.tick(); this.persist(); this.stopSound(); }
}
