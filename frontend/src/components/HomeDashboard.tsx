import {
  BookOpen,
  CalendarDays,
  GripVertical,
  NotebookPen,
  Pause,
  Play,
  Plus,
  RefreshCw,
  School,
  Timer,
  Trash2,
  TriangleAlert
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAdmissionsFeed, getScorelineDetail, getScorelineIndex } from "../api";
import type {
  AdmissionsFeed,
  AdmissionsScorelineDetail,
  AdmissionsScorelineIndex,
  QuestionBank
} from "../types";

type Props = {
  questionBanks: QuestionBank[];
};

type HomePanelId = "target" | "pomodoro" | "feed" | "banks" | "focus";
type PomodoroMode = "focus" | "shortBreak" | "longBreak";
type PomodoroDurations = Record<PomodoroMode, number>;
type PomodoroState = {
  mode: PomodoroMode;
  remainingSeconds: number;
  running: boolean;
  completedRounds: number;
  updatedAt: number;
};
type TodoItem = {
  id: string;
  text: string;
  date: string;
  done: boolean;
  createdAt: number;
};
type TargetState = {
  school: string;
  major: string;
};

const PANEL_ORDER_KEY = "paper-helper.home.panel-order.v3";
const POMODORO_KEY = "paper-helper.home.pomodoro.v2";
const POMODORO_DURATION_KEY = "paper-helper.home.pomodoro-durations.v1";
const TODO_KEY = "paper-helper.home.todo-notebook.v1";
const TARGET_KEY = "paper-helper.home.target.v1";
const DEFAULT_PANEL_ORDER: HomePanelId[] = ["pomodoro", "focus", "target", "feed", "banks"];
const DEFAULT_POMODORO_DURATIONS: PomodoroDurations = {
  focus: 25,
  shortBreak: 5,
  longBreak: 15
};
const POMODORO_MODES: PomodoroMode[] = ["focus", "shortBreak", "longBreak"];
const POMODORO_LABELS: Record<PomodoroMode, string> = {
  focus: "专注",
  shortBreak: "短休",
  longBreak: "长休"
};
const POMODORO_QUOTES = [
  "喵，已经到点了，先把这一段收好。",
  "小猫点头：这一轮做得挺像样。",
  "喵一声，今天这段时间可以先落袋。",
  "这只小猫觉得，你刚刚很稳。",
  "先让脑子喘口气，下一轮再抬头冲。",
  "不错，专注力刚刚好地收住了。"
];
const TODO_PRAISES = [
  "这一下很稳，今天的任务又少了一格。",
  "不错，清单开始往下走了。",
  "这步很轻巧，节奏已经抓住了。",
  "很可以，今天的复习线条清楚了。",
  "小小一项完成，今天就更像样了。"
];

const panelMeta: Record<HomePanelId, { title: string; kicker: string; icon: JSX.Element }> = {
  target: { title: "备考目标", kicker: "FOCUS", icon: <School size={16} /> },
  pomodoro: { title: "番茄钟", kicker: "TIMER", icon: <Timer size={16} /> },
  feed: { title: "研招网近况", kicker: "OFFICIAL FEED", icon: <CalendarDays size={16} /> },
  banks: { title: "题库概览", kicker: "LIBRARY", icon: <BookOpen size={16} /> },
  focus: { title: "今日待办", kicker: "NOTEBOOK", icon: <NotebookPen size={16} /> }
};

const TODO_PRAISES_PLAYFUL = [
  "啪，这条任务已经被你轻轻按住了。",
  "很好，今天的清单又少了一只小麻烦。",
  "小猫点头，这步收得又稳又干净。",
  "不错，复习线条正在一格一格变轻。",
  "这一下很利索，今天的进度已经顺手了。",
  "喵，任务被你拎走了，状态也顺便更好了。"
];

const FALLBACK_MAJOR_OPTIONS = [
  "统考生",
  "单考生",
  "专项计划",
  "学术学位",
  "专业学位",
  "全日制",
  "非全日制"
];

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

function createTodoItem(text = ""): TodoItem {
  return {
    id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    date: todayKey(),
    done: false,
    createdAt: Date.now()
  };
}

function pickRandom(items: string[]): string {
  return items[Math.floor(Math.random() * items.length)] ?? "";
}

function AbstractCatMark({ className = "" }: { className?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <path
        d="M28 42 L14 18 L38 32 Z"
        fill="var(--cyan)"
        stroke="var(--ink)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M92 42 L106 18 L82 32 Z"
        fill="var(--red)"
        stroke="var(--ink)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <circle cx="60" cy="68" r="32" fill="var(--paper-strong)" stroke="var(--ink)" strokeWidth="4" />
      <circle cx="52" cy="60" r="4" fill="var(--ink)" />
      <circle cx="68" cy="60" r="4" fill="var(--ink)" />
      <path d="M57 71 L60 75 L63 71" fill="var(--yellow)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M48 81 Q60 89 72 81" fill="none" stroke="var(--ink)" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M86 70 Q102 82 97 103" fill="none" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />
      <path d="M38 58 Q28 61 22 66" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M38 66 Q29 69 22 74" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M82 58 Q92 61 98 66" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M82 66 Q91 69 98 74" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function clampMinutes(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(180, Math.round(parsed)));
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

function loadTargetState(): TargetState {
  try {
    const raw = window.localStorage.getItem(TARGET_KEY);
    if (!raw) return { school: "", major: "" };
    const parsed = JSON.parse(raw) as Partial<TargetState>;
    return {
      school: typeof parsed.school === "string" ? parsed.school : "",
      major: typeof parsed.major === "string" ? parsed.major : ""
    };
  } catch {
    return { school: "", major: "" };
  }
}

function loadTodoItems(): TodoItem[] {
  try {
    const raw = window.localStorage.getItem(TODO_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<TodoItem>>;
    return parsed.map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: typeof item.text === "string" ? item.text : "",
      date: typeof item.date === "string" && item.date ? item.date : todayKey(),
      done: Boolean(item.done),
      createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now()
    }));
  } catch {
    return [];
  }
}

function loadPomodoroDurations(): PomodoroDurations {
  try {
    const raw = window.localStorage.getItem(POMODORO_DURATION_KEY);
    if (!raw) return DEFAULT_POMODORO_DURATIONS;
    const parsed = JSON.parse(raw) as Partial<PomodoroDurations>;
    return {
      focus: clampMinutes(parsed.focus, DEFAULT_POMODORO_DURATIONS.focus),
      shortBreak: clampMinutes(parsed.shortBreak, DEFAULT_POMODORO_DURATIONS.shortBreak),
      longBreak: clampMinutes(parsed.longBreak, DEFAULT_POMODORO_DURATIONS.longBreak)
    };
  } catch {
    return DEFAULT_POMODORO_DURATIONS;
  }
}

function getModeSeconds(mode: PomodoroMode, durations: PomodoroDurations): number {
  return Math.max(60, durations[mode] * 60);
}

function loadPomodoroState(durations: PomodoroDurations): PomodoroState {
  try {
    const raw = window.localStorage.getItem(POMODORO_KEY);
    if (!raw) throw new Error("missing");
    const parsed = JSON.parse(raw) as Partial<PomodoroState>;
    const mode = parsed.mode && parsed.mode in durations ? (parsed.mode as PomodoroMode) : "focus";
    const total = getModeSeconds(mode, durations);
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
      remainingSeconds: Math.min(baseRemaining, total),
      running: false,
      completedRounds,
      updatedAt: Date.now()
    };
  } catch {
    return {
      mode: "focus",
      remainingSeconds: getModeSeconds("focus", durations),
      running: false,
      completedRounds: 0,
      updatedAt: Date.now()
    };
  }
}

function todayKey(reference = new Date()): string {
  const year = reference.getFullYear();
  const month = String(reference.getMonth() + 1).padStart(2, "0");
  const day = String(reference.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(value: string, days: number): string {
  const base = new Date(`${value || todayKey()}T00:00:00`);
  if (Number.isNaN(base.getTime())) return todayKey();
  base.setDate(base.getDate() + days);
  return todayKey(base);
}

function parseDate(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateLabel(value: string): string {
  const date = parseDate(value);
  if (!date) return value || "未设置日期";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
}

function formatTodoGroupLabel(value: string): string {
  const today = todayKey();
  const tomorrow = shiftDate(today, 1);
  if (value === today) return "今天";
  if (value === tomorrow) return "明天";
  const date = parseDate(value);
  if (!date) return value || "未设置日期";
  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
}

function splitTodoLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s\-*•·\d.、]+/, "").trim())
    .filter(Boolean);
}

function groupTodoItems(items: TodoItem[]): Array<{ date: string; items: TodoItem[] }> {
  const ordered = [...items].sort(
    (a, b) => a.date.localeCompare(b.date) || Number(a.done) - Number(b.done) || a.createdAt - b.createdAt
  );
  const groups = new Map<string, TodoItem[]>();
  ordered.forEach((item) => {
    const bucket = groups.get(item.date);
    if (bucket) bucket.push(item);
    else groups.set(item.date, [item]);
  });
  return Array.from(groups.entries()).map(([date, grouped]) => ({ date, items: grouped }));
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

function formatScorelineDate(publishedAt: string): string {
  return new Date(publishedAt).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function formatSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatMinutesLabel(minutes: number): string {
  return `${minutes} 分`;
}

export function HomeDashboard({ questionBanks }: Props): JSX.Element {
  const [feed, setFeed] = useState<AdmissionsFeed | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState("");
  const [scorelineIndex, setScorelineIndex] = useState<AdmissionsScorelineIndex | null>(null);
  const [scorelineIndexLoading, setScorelineIndexLoading] = useState(true);
  const [scorelineIndexError, setScorelineIndexError] = useState("");
  const [scorelineDetail, setScorelineDetail] = useState<AdmissionsScorelineDetail | null>(null);
  const [scorelineDetailLoading, setScorelineDetailLoading] = useState(false);
  const [scorelineDetailError, setScorelineDetailError] = useState("");
  const [panelOrder, setPanelOrder] = useState<HomePanelId[]>(loadStoredOrder);
  const [dragging, setDragging] = useState<HomePanelId | null>(null);
  const [target, setTarget] = useState<TargetState>(loadTargetState);
  const [todoItems, setTodoItems] = useState<TodoItem[]>(loadTodoItems);
  const [todoBatchDate, setTodoBatchDate] = useState(todayKey());
  const [todoBatchText, setTodoBatchText] = useState("");
  const [todoPraise, setTodoPraise] = useState<string | null>(null);
  const [pomodoroDurations, setPomodoroDurations] = useState<PomodoroDurations>(() => loadPomodoroDurations());
  const [pomodoro, setPomodoro] = useState<PomodoroState>(() => loadPomodoroState(loadPomodoroDurations()));
  const [pomodoroFinish, setPomodoroFinish] = useState<string | null>(null);
  const [scorelineRefreshKey, setScorelineRefreshKey] = useState(0);
  const todoToastTimerRef = useRef<number | null>(null);
  const lastPomodoroRef = useRef({ running: pomodoro.running, remainingSeconds: pomodoro.remainingSeconds });

  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);
    void getAdmissionsFeed()
      .then((nextFeed) => {
        if (!cancelled) setFeed(nextFeed);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFeedError(error instanceof Error ? error.message : "研招网信息加载失败");
      })
      .finally(() => {
        if (!cancelled) setFeedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setScorelineIndexLoading(true);
    setScorelineIndexError("");
    void getScorelineIndex()
      .then((nextIndex) => {
        if (cancelled) return;
        setScorelineIndex(nextIndex);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setScorelineIndex(null);
        setScorelineIndexError(error instanceof Error ? error.message : "研招网分数线加载失败");
      })
      .finally(() => {
        if (!cancelled) setScorelineIndexLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scorelineRefreshKey]);

  useEffect(() => {
    if (!scorelineIndex || scorelineIndex.items.length === 0) return;
    setTarget((current) => {
      const currentSchool = current.school.trim();
      const exists = scorelineIndex.items.some((item) => item.school.trim() === currentSchool);
      if (current.school && exists) return current;
      return {
        ...current,
        school: scorelineIndex.items[0].school
      };
    });
  }, [scorelineIndex]);

  useEffect(() => {
    const selectedSchool = target.school.trim();
    const selected = scorelineIndex?.items.find((item) => item.school.trim() === selectedSchool);
    if (!selected || !scorelineIndex) {
      setScorelineDetail(null);
      setScorelineDetailError(scorelineIndex ? "当前学校暂时没有找到去年分数线。" : "");
      setScorelineDetailLoading(false);
      return;
    }
    let cancelled = false;
    setScorelineDetailLoading(true);
    setScorelineDetailError("");
    void getScorelineDetail(selected.url)
      .then((nextDetail) => {
        if (!cancelled) setScorelineDetail(nextDetail);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setScorelineDetail(null);
          setScorelineDetailError(error instanceof Error ? error.message : "研招网分数线正文加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setScorelineDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scorelineIndex, target.school]);

  useEffect(() => {
    window.localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(panelOrder));
  }, [panelOrder]);

  useEffect(() => {
    window.localStorage.setItem(TARGET_KEY, JSON.stringify(target));
  }, [target]);

  useEffect(() => {
    window.localStorage.setItem(TODO_KEY, JSON.stringify(todoItems));
  }, [todoItems]);

  useEffect(() => {
    window.localStorage.setItem(POMODORO_DURATION_KEY, JSON.stringify(pomodoroDurations));
  }, [pomodoroDurations]);

  useEffect(() => {
    window.localStorage.setItem(POMODORO_KEY, JSON.stringify(pomodoro));
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

  useEffect(() => {
    const previous = lastPomodoroRef.current;
    if (previous.running && previous.remainingSeconds > 0 && !pomodoro.running && pomodoro.remainingSeconds === 0) {
      setPomodoroFinish(pickRandom(POMODORO_QUOTES));
    }
    lastPomodoroRef.current = {
      running: pomodoro.running,
      remainingSeconds: pomodoro.remainingSeconds
    };
  }, [pomodoro.running, pomodoro.remainingSeconds]);

  useEffect(() => {
    return () => {
      if (todoToastTimerRef.current !== null) {
        window.clearTimeout(todoToastTimerRef.current);
      }
    };
  }, []);

  const recentFeed = useMemo(() => feed?.items.slice(0, 8) ?? [], [feed]);
  const lastUpdated = feed?.updated_at ? new Date(feed.updated_at).toLocaleString("zh-CN", { hour12: false }) : "未加载";
  const selectedScorelineItem = useMemo(
    () =>
      scorelineIndex?.items.find((item) => item.school.trim() === target.school.trim()) ??
      scorelineIndex?.items[0] ??
      null,
    [scorelineIndex, target.school]
  );
  const targetMajorOptions = useMemo(() => {
    const sections = scorelineDetail?.sections ?? [];
    const options = [...sections, ...FALLBACK_MAJOR_OPTIONS];
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const option of options) {
      const normalized = option.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      deduped.push(normalized);
    }
    return deduped;
  }, [scorelineDetail?.sections]);
  useEffect(() => {
    if (!targetMajorOptions.length) return;
    setTarget((current) => {
      const currentMajor = current.major.trim();
      if (currentMajor && targetMajorOptions.includes(currentMajor)) return current;
      return { ...current, major: targetMajorOptions[0] ?? "" };
    });
  }, [targetMajorOptions]);
  const todoGroups = useMemo(() => groupTodoItems(todoItems), [todoItems]);
  const todoDoneCount = todoItems.filter((item) => item.done).length;
  const todoPendingCount = todoItems.length - todoDoneCount;
  const pomodoroTotal = getModeSeconds(pomodoro.mode, pomodoroDurations);
  const pomodoroProgress = Math.max(0, Math.min(1, 1 - pomodoro.remainingSeconds / Math.max(1, pomodoroTotal)));
  const pomodoroStatus = pomodoro.running
    ? "计时中"
    : pomodoro.remainingSeconds <= 0
      ? "已结束"
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

  function refreshScorelineIndex(): void {
    setScorelineRefreshKey((value) => value + 1);
  }

  function selectTargetSchool(school: string): void {
    setTarget((current) => ({ ...current, school: school.trim(), major: "" }));
  }

  function updateTargetMajor(major: string): void {
    setTarget((current) => ({ ...current, major }));
  }

  function pushTodoPraise(): void {
    if (todoToastTimerRef.current !== null) {
      window.clearTimeout(todoToastTimerRef.current);
    }
    setTodoPraise(pickRandom(TODO_PRAISES_PLAYFUL));
    todoToastTimerRef.current = window.setTimeout(() => {
      setTodoPraise(null);
    }, 2400);
  }

  function addTodoItem(afterIndex?: number): void {
    setTodoItems((current) => {
      const next = [...current];
      const item = createTodoItem("");
      if (afterIndex === undefined || afterIndex < 0 || afterIndex >= next.length) {
        next.push(item);
      } else {
        next.splice(afterIndex + 1, 0, item);
      }
      return next;
    });
  }

  function updateTodoText(index: number, text: string): void {
    setTodoItems((current) => current.map((item, position) => (position === index ? { ...item, text } : item)));
  }

  function toggleTodoDone(index: number, done: boolean): void {
    const previous = todoItems[index];
    setTodoItems((current) => current.map((item, position) => (position === index ? { ...item, done } : item)));
    if (previous && !previous.done && done) {
      pushTodoPraise();
    }
  }

  function deleteTodoItem(index: number): void {
    setTodoItems((current) => current.filter((_, position) => position !== index));
  }

  function quickSetTodoDate(days: number): void {
    setTodoBatchDate((current) => shiftDate(current || todayKey(), days));
  }

  function addTodoBatch(): void {
    const lines = splitTodoLines(todoBatchText);
    if (!lines.length) return;
    const date = todoBatchDate || todayKey();
    const stamp = Date.now();
    setTodoItems((current) => [
      ...current,
      ...lines.map((text, index) => ({
        id: `todo-${stamp}-${Math.random().toString(36).slice(2, 8)}-${index}`,
        text,
        date,
        done: false,
        createdAt: stamp + index
      }))
    ]);
    setTodoBatchText("");
    setTodoBatchDate(date);
  }

  function updateTodoTextById(id: string, text: string): void {
    setTodoItems((current) => current.map((item) => (item.id === id ? { ...item, text } : item)));
  }

  function updateTodoDateById(id: string, date: string): void {
    const nextDate = date || todayKey();
    setTodoItems((current) => current.map((item) => (item.id === id ? { ...item, date: nextDate } : item)));
  }

  function toggleTodoDoneById(id: string, done: boolean): void {
    const previous = todoItems.find((item) => item.id === id);
    setTodoItems((current) => current.map((item) => (item.id === id ? { ...item, done } : item)));
    if (previous && !previous.done && done) {
      pushTodoPraise();
    }
  }

  function deleteTodoItemById(id: string): void {
    setTodoItems((current) => current.filter((item) => item.id !== id));
  }

  function setPomodoroMode(mode: PomodoroMode): void {
    setPomodoro((current) => ({
      ...current,
      mode,
      remainingSeconds: getModeSeconds(mode, pomodoroDurations),
      running: false,
      updatedAt: Date.now()
    }));
  }

  function changePomodoroDuration(mode: PomodoroMode, minutes: number): void {
    const nextMinutes = clampMinutes(minutes, pomodoroDurations[mode]);
    const nextDurations = { ...pomodoroDurations, [mode]: nextMinutes };
    setPomodoroDurations(nextDurations);
    if (pomodoro.mode === mode && !pomodoro.running) {
      setPomodoro((current) => ({
        ...current,
        remainingSeconds: getModeSeconds(mode, nextDurations),
        updatedAt: Date.now()
      }));
    }
  }

  function togglePomodoroRunning(): void {
    setPomodoro((current) => {
      const nextRemaining = current.remainingSeconds <= 0 ? getModeSeconds(current.mode, pomodoroDurations) : current.remainingSeconds;
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
      remainingSeconds: getModeSeconds(current.mode, pomodoroDurations),
      running: false,
      updatedAt: Date.now()
    }));
  }

  function restartPomodoro(): void {
    setPomodoroFinish(null);
    setPomodoro((current) => ({
      ...current,
      remainingSeconds: getModeSeconds(current.mode, pomodoroDurations),
      running: true,
      updatedAt: Date.now()
    }));
  }

  function dismissPomodoroFinish(): void {
    setPomodoroFinish(null);
  }

  function renderPanel(id: HomePanelId): JSX.Element {
    const meta = panelMeta[id];
    return (
      <section
        key={id}
        className={`home-panel panel ${id === "target" || id === "feed" || id === "banks" ? "home-panel-span-2" : ""} ${
          dragging === id ? "is-dragging" : ""
        }`}
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
          <span className="home-panel-grip" title="拖动排序">
            <GripVertical size={16} />
          </span>
        </div>

        {id === "target" && (
          <div className="home-panel-body home-target">
            <div className="home-target-summary">
              <span>目标院校 / 专业</span>
              <strong>
                {selectedScorelineItem?.school || target.school || "先选一个学校"}
                {target.major ? ` · ${target.major}` : ""}
              </strong>
              <p>{scorelineIndex?.target_year ? `官方已拉取 ${scorelineIndex.target_year} 年录取分数线。` : "先拉取官方数据，再把目标院校和专业挂上去。"}</p>
            </div>

            <div className="home-target-layout">
              <div className="home-target-controls">
                <label className="home-target-field">
                  <span>目标院校</span>
                  <select value={target.school || selectedScorelineItem?.school || ""} onChange={(event) => selectTargetSchool(event.target.value)}>
                    {scorelineIndexLoading && <option value="">正在加载官方院校列表...</option>}
                    {!scorelineIndexLoading && scorelineIndex?.items.length === 0 && <option value="">没有抓到可用院校</option>}
                    {scorelineIndex?.items.map((item) => (
                      <option value={item.school} key={`${item.school}-${item.url}`}>
                        {item.school} · {item.year}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="home-target-field">
                  <span>目标专业 / 分数线类型</span>
                  <select value={target.major || targetMajorOptions[0] || ""} onChange={(event) => updateTargetMajor(event.target.value)}>
                    {targetMajorOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="home-target-actions">
                  <button type="button" className="outline-action" onClick={refreshScorelineIndex}>
                    <RefreshCw size={16} />
                    重新拉取
                  </button>
                </div>

                {scorelineIndexError ? (
                  <div className="home-scoreline-warning">
                    <TriangleAlert size={14} />
                    {scorelineIndexError}
                  </div>
                ) : null}
              </div>

                <div className="home-scoreline-card">
                  <div className="home-scoreline-head">
                    <div>
                      <span>对应录取分数线</span>
                      <strong>{selectedScorelineItem ? selectedScorelineItem.school : "等待官方数据"}</strong>
                    </div>
                    {selectedScorelineItem ? <small>{formatScorelineDate(selectedScorelineItem.published_at)}</small> : null}
                  </div>

                {scorelineDetailLoading ? (
                  <div className="home-scoreline-empty">正在读取官方正文。</div>
                ) : scorelineDetailError ? (
                  <div className="home-scoreline-empty">{scorelineDetailError}</div>
                ) : scorelineDetail ? (
                  <>
                    {scorelineDetail.image_url ? (
                      <div className="home-scoreline-image-wrap">
                        <img
                          className="home-scoreline-image"
                          src={scorelineDetail.image_url}
                          alt={`${selectedScorelineItem?.school || "官方分数线"}图片`}
                        />
                      </div>
                    ) : null}
                    {scorelineDetail.sections.length ? (
                      <div className="home-scoreline-tags" aria-label="分数线栏目">
                        {scorelineDetail.sections.slice(0, 8).map((section) => (
                          <span key={section}>{section}</span>
                        ))}
                      </div>
                    ) : null}
                    {scorelineDetail.image_url ? (
                      <details className="home-scoreline-details">
                        <summary>查看官方提取文本</summary>
                        <div className="home-scoreline-content">{scorelineDetail.content}</div>
                      </details>
                    ) : (
                      <div className="home-scoreline-content">{scorelineDetail.content}</div>
                    )}
                  </>
                ) : (
                  <div className="home-scoreline-empty">
                    {scorelineIndexLoading ? "官方院校列表还在加载。" : "先选一个院校，去年分数线就会出来。"}
                  </div>
                )}

                {scorelineDetail?.pdf_url ? (
                  <div className="home-scoreline-links">
                    <a href={scorelineDetail.pdf_url} target="_blank" rel="noreferrer">
                      打开官方 PDF
                    </a>
                    {selectedScorelineItem?.url ? (
                      <a href={selectedScorelineItem.url} target="_blank" rel="noreferrer">
                        打开官方原文
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {id === "pomodoro" && (
          <div className="home-panel-body home-pomodoro">
            <div className="home-pomodoro-layout">
              <div className="home-pomodoro-display">
                <strong>{formatSeconds(pomodoro.remainingSeconds)}</strong>
                <span>
                  {POMODORO_LABELS[pomodoro.mode]} · {pomodoroStatus}
                </span>
                <div className="home-pomodoro-progress">
                  <i style={{ width: `${pomodoroProgress * 100}%` }} />
                </div>
                <div className="home-pomodoro-meta">
                  <span>完成 {pomodoro.completedRounds} 轮</span>
                  <span>当前时长 {formatMinutesLabel(pomodoroDurations[pomodoro.mode])}</span>
                </div>
              </div>

              <div className="home-pomodoro-controls">
                <div className="home-pomodoro-mode-buttons">
                  {POMODORO_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={pomodoro.mode === mode ? "is-active" : ""}
                      onClick={() => setPomodoroMode(mode)}
                    >
                      {POMODORO_LABELS[mode]} {formatMinutesLabel(pomodoroDurations[mode])}
                    </button>
                  ))}
                </div>

                <div className="home-pomodoro-duration-grid">
                  {POMODORO_MODES.map((mode) => (
                    <label className="home-pomodoro-duration-item" key={`${mode}-duration`}>
                      <span>{POMODORO_LABELS[mode]}</span>
                      <input
                        type="number"
                        min={1}
                        max={180}
                        value={pomodoroDurations[mode]}
                        onChange={(event) => changePomodoroDuration(mode, Number(event.target.value))}
                      />
                    </label>
                  ))}
                </div>

                <div className="home-pomodoro-actions">
                  <button type="button" className="primary-action compact" onClick={togglePomodoroRunning}>
                    {pomodoro.running ? <Pause size={16} /> : <Play size={16} />}
                    {pomodoro.running ? "暂停" : pomodoro.remainingSeconds <= 0 ? "重新开始" : "开始"}
                  </button>
                  <button type="button" className="outline-action" onClick={resetPomodoro}>
                    重置
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {id === "feed" && (
          <div className="home-panel-body home-feed">
            <div className="home-feed-meta">
              <span>最近更新 {lastUpdated}</span>
              {feed?.errors?.length ? (
                <span className="home-feed-warning">
                  <TriangleAlert size={14} /> 部分来源不可达
                </span>
              ) : null}
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
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.source}
                  </a>
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
              questionBanks.slice(0, 6).map((bank) => (
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
          <div className="home-panel-body home-todo">
            <div className="home-todo-toolbar">
              <div>
                <strong>今日待办</strong>
                <span>
                  已完成 {todoDoneCount} / {todoItems.length} · 待办 {todoPendingCount}
                </span>
              </div>
              <button type="button" className="outline-action" onClick={() => addTodoItem()}>
                <Plus size={16} />
                新增一条
              </button>
            </div>

            {todoItems.length === 0 ? (
              <div className="home-todo-empty">先写一条今天要办的事，做完会给你弹个小夸夸。</div>
            ) : (
              <div className="home-todo-list">
                {todoItems.map((item, index) => (
                  <div className={`home-todo-item ${item.done ? "is-done" : ""}`} key={item.id}>
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={(event) => toggleTodoDone(index, event.target.checked)}
                      aria-label={`完成待办 ${index + 1}`}
                    />
                    <input
                      type="text"
                      value={item.text}
                      onChange={(event) => updateTodoText(index, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addTodoItem(index);
                        }
                      }}
                      placeholder="写下今天要做的事"
                    />
                    <button type="button" className="home-todo-delete" onClick={() => deleteTodoItem(index)} aria-label={`删除待办 ${index + 1}`}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="home-layout">
      <div className="home-grid">{panelOrder.map((id) => renderPanel(id))}</div>

      {todoPraise ? (
        <div className="home-toast" role="status" aria-live="polite">
          <div className="home-toast-cat">
            <AbstractCatMark className="home-cat-art home-cat-art-toast" />
          </div>
          <div className="home-toast-copy">
            <small>今日待办</small>
            <strong>{todoPraise}</strong>
          </div>
        </div>
      ) : null}

      {pomodoroFinish ? (
        <div className="home-modal-overlay" role="presentation">
          <div className="home-modal" role="dialog" aria-modal="true" aria-label="番茄钟结束">
            <div className="home-modal-cat">
              <AbstractCatMark className="home-cat-art home-cat-art-modal" />
            </div>
            <div className="home-modal-copy">
              <div className="section-kicker">TIMER DONE</div>
              <strong>番茄钟结束</strong>
              <p>{pomodoroFinish}</p>
            </div>
            <div className="home-modal-actions">
              <button type="button" className="primary-action compact" onClick={restartPomodoro}>
                重新进行计时
              </button>
              <button type="button" className="outline-action" onClick={dismissPomodoroFinish}>
                就到这里
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
