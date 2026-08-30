import {
  ArrowUpDown,
  BookOpen,
  CalendarDays,
  GripVertical,
  Pause,
  Play,
  RefreshCw,
  Target,
  Timer,
  TrendingUp,
  TriangleAlert
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAdmissionsFeed } from "../api";
import type { AdmissionsFeed, QuestionBank } from "../types";

type Props = {
  questionBanks: QuestionBank[];
  statusSummary: string;
  questionCount: number;
  templateCount: number;
};

type HomePanelId = "target" | "pomodoro" | "stats" | "feed" | "banks" | "focus";
type PomodoroMode = "focus" | "shortBreak" | "longBreak";

type PomodoroState = {
  mode: PomodoroMode;
  remainingSeconds: number;
  running: boolean;
  completedRounds: number;
  updatedAt: number;
};

const PANEL_ORDER_KEY = "paper-helper.home.panel-order.v1";
const POMODORO_KEY = "paper-helper.home.pomodoro.v1";
const DEFAULT_PANEL_ORDER: HomePanelId[] = ["target", "pomodoro", "stats", "feed", "banks", "focus"];
const POMODORO_PRESETS: Record<PomodoroMode, number> = {
  focus: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60
};
const POMODORO_LABELS: Record<PomodoroMode, string> = {
  focus: "专注",
  shortBreak: "短休",
  longBreak: "长休"
};

const panelMeta: Record<HomePanelId, { title: string; kicker: string; icon: JSX.Element; wide?: boolean }> = {
  target: { title: "备考目标", kicker: "FOCUS", icon: <Target size={16} /> },
  pomodoro: { title: "番茄钟", kicker: "TIMER", icon: <Timer size={16} /> },
  stats: { title: "本地状态", kicker: "SYSTEM", icon: <TrendingUp size={16} /> },
  feed: { title: "研招网近况", kicker: "OFFICIAL FEED", icon: <CalendarDays size={16} />, wide: true },
  banks: { title: "题库概览", kicker: "LIBRARY", icon: <BookOpen size={16} /> },
  focus: { title: "今日动作", kicker: "NEXT STEP", icon: <RefreshCw size={16} /> }
};

function clampOrder(order: HomePanelId[]): HomePanelId[] {
  const seen = new Set<HomePanelId>();
  const normalized = order.filter((item) => {
    if (seen.has(item) || !DEFAULT_PANEL_ORDER.includes(item)) return false;
    seen.add(item);
    return true;
  });
  DEFAULT_PANEL_ORDER.forEach((item) => {
    if (!seen.has(item)) normalized.push(item);
  });
  return normalized;
}

function moveItem(items: HomePanelId[], from: number, to: number): HomePanelId[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function loadStoredOrder(): HomePanelId[] {
  try {
    const raw = window.localStorage.getItem(PANEL_ORDER_KEY);
    if (!raw) return DEFAULT_PANEL_ORDER;
    const parsed = JSON.parse(raw) as HomePanelId[];
    return clampOrder(parsed);
  } catch {
    return DEFAULT_PANEL_ORDER;
  }
}

function loadPomodoroState(): PomodoroState {
  try {
    const raw = window.localStorage.getItem(POMODORO_KEY);
    if (!raw) throw new Error("missing");
    const parsed = JSON.parse(raw) as Partial<PomodoroState>;
    const mode = parsed.mode && parsed.mode in POMODORO_PRESETS ? (parsed.mode as PomodoroMode) : "focus";
    const total = POMODORO_PRESETS[mode];
    const completedRounds = Math.max(0, Number(parsed.completedRounds ?? 0));
    const baseRemaining = Math.max(0, Number(parsed.remainingSeconds ?? total));
    const running = Boolean(parsed.running);
    const updatedAt = Math.max(0, Number(parsed.updatedAt ?? Date.now()));
    if (running) {
      const elapsed = Math.floor((Date.now() - updatedAt) / 1000);
      const remainingSeconds = Math.max(0, baseRemaining - elapsed);
      return {
        mode,
        remainingSeconds,
        running: remainingSeconds > 0,
        completedRounds,
        updatedAt: Date.now()
      };
    }
    return {
      mode,
      remainingSeconds: Number.isFinite(baseRemaining) ? Math.min(baseRemaining, total) : total,
      running: false,
      completedRounds,
      updatedAt: Date.now()
    };
  } catch {
    return {
      mode: "focus",
      remainingSeconds: POMODORO_PRESETS.focus,
      running: false,
      completedRounds: 0,
      updatedAt: Date.now()
    };
  }
}

function formatAgeLabel(publishedAt: string): string {
  const published = new Date(publishedAt);
  const diff = Math.max(0, Date.now() - published.getTime());
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} 周前`;
  const months = Math.floor(days / 30);
  return `${months} 个月前`;
}

export function HomeView({ questionBanks, statusSummary, questionCount, templateCount }: Props): JSX.Element {
  const [feed, setFeed] = useState<AdmissionsFeed | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState("");
  const [panelOrder, setPanelOrder] = useState<HomePanelId[]>(loadStoredOrder);
  const [dragging, setDragging] = useState<HomePanelId | null>(null);
  const [pomodoro, setPomodoro] = useState<PomodoroState>(loadPomodoroState);

  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);
    void getAdmissionsFeed()
      .then((nextFeed) => {
        if (cancelled) return;
        setFeed(nextFeed);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFeedError(error instanceof Error ? error.message : "研招网信息加载失败");
      })
      .finally(() => {
        if (!cancelled) setFeedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(panelOrder));
  }, [panelOrder]);

  useEffect(() => {
    window.localStorage.setItem(POMODORO_KEY, JSON.stringify({ ...pomodoro, updatedAt: Date.now() }));
  }, [pomodoro]);

  useEffect(() => {
    if (!pomodoro.running) return;
    const timer = window.setInterval(() => {
      setPomodoro((current) => {
        if (!current.running) return current;
        if (current.remainingSeconds <= 1) {
          return {
            ...current,
            remainingSeconds: 0,
            running: false,
            completedRounds: current.mode === "focus" ? current.completedRounds + 1 : current.completedRounds,
            updatedAt: Date.now()
          };
        }
        return {
          ...current,
          remainingSeconds: current.remainingSeconds - 1,
          updatedAt: Date.now()
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pomodoro.running]);

  const recentFeed = useMemo(() => feed?.items.slice(0, 8) ?? [], [feed]);
  const lastUpdated = feed?.updated_at ? new Date(feed.updated_at).toLocaleString("zh-CN", { hour12: false }) : "未加载";
  const pomodoroTotal = POMODORO_PRESETS[pomodoro.mode];
  const pomodoroProgress = 1 - pomodoro.remainingSeconds / Math.max(1, pomodoroTotal);
  const pomodoroStatus = pomodoro.running
    ? "计时中"
    : pomodoro.remainingSeconds <= 0
      ? "已完成"
      : "已暂停";

  function handleDragStart(id: HomePanelId): void {
    setDragging(id);
  }

  function handleDrop(targetId: HomePanelId): void {
    if (!dragging || dragging === targetId) return;
    const from = panelOrder.indexOf(dragging);
    const to = panelOrder.indexOf(targetId);
    setPanelOrder(moveItem(panelOrder, from, to));
    setDragging(null);
  }

  function setPomodoroMode(mode: PomodoroMode): void {
    setPomodoro((current) => ({
      ...current,
      mode,
      remainingSeconds: POMODORO_PRESETS[mode],
      running: false,
      updatedAt: Date.now()
    }));
  }

  function togglePomodoroRunning(): void {
    setPomodoro((current) => {
      const nextRemaining = current.remainingSeconds <= 0 ? POMODORO_PRESETS[current.mode] : current.remainingSeconds;
      return {
        ...current,
        remainingSeconds: nextRemaining,
        running: !current.running,
        updatedAt: Date.now()
      };
    });
  }

  function resetPomodoro(): void {
    setPomodoro((current) => ({
      ...current,
      remainingSeconds: POMODORO_PRESETS[current.mode],
      running: false,
      updatedAt: Date.now()
    }));
  }

  function renderPanel(id: HomePanelId): JSX.Element {
    const meta = panelMeta[id];
    const isWide = Boolean(meta.wide);
    return (
      <section
        key={id}
        className={`home-panel panel ${isWide ? "home-panel-wide" : ""} ${dragging === id ? "is-dragging" : ""}`}
        draggable
        onDragStart={() => handleDragStart(id)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => handleDrop(id)}
      >
        <div className="home-panel-head">
          <div>
            <div className="section-kicker">{meta.kicker}</div>
            <div className="home-panel-title">
              <span className="home-panel-icon">{meta.icon}</span>
              <h2>{meta.title}</h2>
            </div>
          </div>
          <span className="home-panel-grip"><GripVertical size={16} /></span>
        </div>
        {id === "target" && (
          <div className="home-panel-body home-target">
            <strong>考研复习工作台</strong>
            <p>围绕真题输入、模板组卷、连续刷题、错题回收四条线推进，不做泛化内容堆叠。</p>
            <div className="home-metric-line">
              <span>题目总量</span>
              <strong>{questionCount}</strong>
            </div>
            <div className="home-metric-line">
              <span>模板数量</span>
              <strong>{templateCount}</strong>
            </div>
          </div>
        )}
        {id === "pomodoro" && (
          <div className="home-panel-body home-pomodoro">
            <div className="home-pomodoro-display">
              <strong>{String(Math.floor(pomodoro.remainingSeconds / 60)).padStart(2, "0")}:{String(pomodoro.remainingSeconds % 60).padStart(2, "0")}</strong>
              <span>{POMODORO_LABELS[pomodoro.mode]} · {pomodoroStatus}</span>
            </div>
            <div className="home-pomodoro-progress">
              <i style={{ width: `${Math.max(0, Math.min(1, pomodoroProgress)) * 100}%` }} />
            </div>
            <div className="home-pomodoro-meta">
              <span>完成 {pomodoro.completedRounds} 轮</span>
              <span>当前模式 {POMODORO_LABELS[pomodoro.mode]}</span>
            </div>
            <div className="home-pomodoro-presets">
              <button type="button" className={pomodoro.mode === "focus" ? "is-active" : ""} onClick={() => setPomodoroMode("focus")}>专注 25</button>
              <button type="button" className={pomodoro.mode === "shortBreak" ? "is-active" : ""} onClick={() => setPomodoroMode("shortBreak")}>短休 5</button>
              <button type="button" className={pomodoro.mode === "longBreak" ? "is-active" : ""} onClick={() => setPomodoroMode("longBreak")}>长休 15</button>
            </div>
            <div className="home-pomodoro-actions">
              <button type="button" className="primary-action compact" onClick={togglePomodoroRunning}>
                {pomodoro.running ? <Pause size={16} /> : <Play size={16} />}
                {pomodoro.running ? "暂停" : pomodoro.remainingSeconds <= 0 ? "重新开始" : "开始"}
              </button>
              <button type="button" className="outline-action" onClick={resetPomodoro}>重置</button>
            </div>
          </div>
        )}
        {id === "stats" && (
          <div className="home-panel-body home-stats">
            <div className="home-stat-card">
              <span>服务状态</span>
              <strong>{statusSummary}</strong>
            </div>
            <div className="home-stat-card">
              <span>题库/模板</span>
              <strong>{questionCount} / {templateCount}</strong>
            </div>
            <div className="home-stat-card">
              <span>数据口径</span>
              <strong>以本地题库为准</strong>
            </div>
          </div>
        )}
        {id === "feed" && (
          <div className="home-panel-body home-feed">
            <div className="home-feed-meta">
              <span>最近更新 {lastUpdated}</span>
              {feed?.errors?.length ? <span className="home-feed-warning"><TriangleAlert size={14} /> 部分来源不可达</span> : null}
            </div>
            {feedLoading && <div className="home-feed-empty">正在拉取研招网最近一年内的信息。</div>}
            {!feedLoading && feedError && <div className="home-feed-empty">{feedError}</div>}
            {!feedLoading && !feedError && recentFeed.length === 0 && <div className="home-feed-empty">最近一年内没有抓到可展示的条目。</div>}
            <div className="home-feed-list">
              {recentFeed.map((item) => (
                <article className="home-feed-item" key={`${item.source}-${item.url}-${item.title}`}>
                  <div className="home-feed-item-head">
                    <span>{item.category}</span>
                    <small>{formatAgeLabel(item.published_at)}</small>
                  </div>
                  <strong>{item.title}</strong>
                  <a href={item.url} target="_blank" rel="noreferrer">{item.source}</a>
                </article>
              ))}
            </div>
          </div>
        )}
        {id === "banks" && (
          <div className="home-panel-body home-banks">
            {questionBanks.length === 0 ? (
              <div className="home-feed-empty">当前没有题库。</div>
            ) : (
              questionBanks.slice(0, 5).map((bank) => (
                <article className="home-bank-item" key={bank.id}>
                  <strong>{bank.name}</strong>
                  <span>{bank.subject}</span>
                  <p>{bank.description || "没有补充说明。"}</p>
                </article>
              ))
            )}
          </div>
        )}
        {id === "focus" && (
          <div className="home-panel-body home-focus">
            <div className="home-step">
              <b>01</b>
              <span>先导入题册，再补答案册。</span>
            </div>
            <div className="home-step">
              <b>02</b>
              <span>模板页内直接进入试题导入。</span>
            </div>
            <div className="home-step">
              <b>03</b>
              <span>用组卷和刷题把新内容吃进来。</span>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="home-layout">
      <section className="home-hero panel panel-blue">
        <div>
          <div className="section-kicker">HOME / CURRENT WORKSPACE</div>
          <h1>考研组卷首页</h1>
          <p>把题册导入、试卷模板、组卷、刷题、错题本和研招网信息放在同一条工作线上。</p>
        </div>
        <div className="home-hero-mark">
          <ArrowUpDown size={42} strokeWidth={2.4} />
          <strong>DRAG</strong>
          <span>可拖动编排首页模块</span>
        </div>
      </section>

      <div className="home-grid">
        {panelOrder.map((id) => renderPanel(id))}
      </div>
    </div>
  );
}
