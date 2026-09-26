import {
  AlarmClock,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
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
import type { DragEvent } from "react";
import { getAdmissionsFeed, getScorelineDetail, getScorelineIndex } from "../api";
import { DesktopPetControls } from "./DesktopPetControls";
import { petAsset } from "../petConfig";
import type {
  AdmissionsFeed,
  AdmissionsScorelineDetail,
  AdmissionsScorelineIndex,
  QuestionBank
} from "../types";

type Props = {
  questionBanks: QuestionBank[];
};

type HomePanelId = "target" | "pomodoro" | "buddy" | "feed" | "banks" | "focus";
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
  reminderAt: string;
  remindedAt: number | null;
  done: boolean;
  createdAt: number;
};
type TargetState = {
  school: string;
  major: string;
};

type BuddyMotion = {
  x: number;
  direction: 1 | -1;
  walking: boolean;
  switchAt: number;
  nextActionAt: number;
  lastFrame: number;
};
type BuddyAutoAction = "wave" | "hop" | null;

const PANEL_ORDER_KEY = "paper-helper.home.panel-order.v5";
const LEGACY_PANEL_ORDER_KEYS = ["paper-helper.home.panel-order.v4", "paper-helper.home.panel-order.v3"];
const POMODORO_KEY = "paper-helper.home.pomodoro.v2";
const POMODORO_DURATION_KEY = "paper-helper.home.pomodoro-durations.v1";
const TODO_KEY = "paper-helper.home.todo-notebook.v1";
const TARGET_KEY = "paper-helper.home.target.v1";
const DEFAULT_PANEL_ORDER: HomePanelId[] = ["pomodoro", "focus", "buddy", "target", "feed", "banks"];
const BUDDY_ASSETS = {
  idle: petAsset("study-buddy-idle.webm"),
  walk: petAsset("study-buddy-walk.webm"),
  click: petAsset("study-buddy-click.webm")
} as const;
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
const BUDDY_MESSAGES = [
  "先处理一条最小任务，进度会自己滚起来。",
  "番茄钟已经准备好了，要不要现在开始？",
  "错题不会自己消失，但可以被你一题一题解决。",
  "今天也给自己留一轮专注时间吧。"
];
const TODO_REMINDER_QUOTES = [
  "喵，时间到了，先把这条收掉。",
  "这只小猫举爪：轮到这一项了。",
  "提醒到了，别让这件事悄悄滑走。",
  "抽象小猫已经蹲在中间等你了。",
  "喵一下，当前这条该处理了。"
];
const TODO_CAT_VARIANTS = ["glyph", "orbit", "signal", "stack"];
const TODO_PRAISES = [
  "这一下很稳，今天的任务又少了一格。",
  "不错，清单开始往下走了。",
  "这步很轻巧，节奏已经抓住了。",
  "很可以，今天的复习线条清楚了。",
  "小小一项完成，今天就更像样了。"
];
const TODO_PRAISES_PLAYFUL = [
  "啪，这条任务已经被你轻轻按住了。",
  "很好，今天的清单又少了一只小麻烦。",
  "小猫点头，这步收得又稳又干净。",
  "不错，复习线条正在一格一格变轻。",
  "这一下很利索，今天的进度已经顺手了。",
  "喵，任务被你拎走了，状态也顺便更好了。"
];

const panelMeta: Record<HomePanelId, { title: string; kicker: string; icon: JSX.Element }> = {
  target: { title: "备考目标", kicker: "FOCUS", icon: <School size={16} /> },
  pomodoro: { title: "番茄钟", kicker: "TIMER", icon: <Timer size={16} /> },
  buddy: { title: "学习桌宠", kicker: "STUDY BUDDY", icon: <span aria-hidden="true">◉</span> },
  feed: { title: "研招网近况", kicker: "OFFICIAL FEED", icon: <CalendarDays size={16} /> },
  banks: { title: "题库概览", kicker: "LIBRARY", icon: <BookOpen size={16} /> },
  focus: { title: "今日待办", kicker: "NOTEBOOK", icon: <NotebookPen size={16} /> }
};

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

function createTodoItem(text = "", date = todayKey(), reminderAt = ""): TodoItem {
  return {
    id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    date,
    reminderAt,
    remindedAt: null,
    done: false,
    createdAt: Date.now()
  };
}

function pickRandom(items: string[]): string {
  return items[Math.floor(Math.random() * items.length)] ?? "";
}

function pickRandomTodoVariant(): string {
  return TODO_CAT_VARIANTS[Math.floor(Math.random() * TODO_CAT_VARIANTS.length)] ?? "glyph";
}

function parseDateTimeValue(value: string): number | null {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function toLocalDateValue(value: string): string {
  const timestamp = parseDateTimeValue(value);
  return timestamp === null ? "" : todayKey(new Date(timestamp));
}

function toLocalTimeValue(value: string): string {
  const timestamp = parseDateTimeValue(value);
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function buildReminderAt(date: string, time: string): string {
  if (!date || !time) return "";
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function formatTodoReminderLabel(reminderAt: string): string {
  const timestamp = parseDateTimeValue(reminderAt);
  if (timestamp === null) return "未设置提醒";
  const date = new Date(timestamp);
  const localDate = todayKey(date);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (localDate === todayKey()) return `今天 ${time}`;
  if (localDate === shiftDate(todayKey(), 1)) return `明天 ${time}`;
  return `${localDate} ${time}`;
}

function getReminderPayload(item: TodoItem) {
  return {
    id: item.id,
    text: item.text,
    date: item.date,
    reminderAt: item.reminderAt,
    variant: pickRandomTodoVariant(),
    message: pickRandom(TODO_REMINDER_QUOTES)
  };
}

type TodoReminder = ReturnType<typeof getReminderPayload>;

function sortTodoItems(items: TodoItem[]): TodoItem[] {
  return [...items].sort((a, b) => {
    const aReminder = parseDateTimeValue(a.reminderAt) ?? Number.POSITIVE_INFINITY;
    const bReminder = parseDateTimeValue(b.reminderAt) ?? Number.POSITIVE_INFINITY;
    return Number(a.done) - Number(b.done) || aReminder - bReminder || a.createdAt - b.createdAt;
  });
}

function normalizeTodoReminderQueue(items: TodoReminder[]): TodoReminder[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function AbstractCatMark({ className = "", variant = "glyph" }: { className?: string; variant?: string }): JSX.Element {
  if (variant === "orbit") {
    return (
      <svg className={className} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle cx="60" cy="60" r="36" fill="none" stroke="var(--ink)" strokeWidth="4" />
        <path d="M28 39 L14 18 L39 31 Z" fill="var(--yellow)" stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round" />
        <path d="M92 39 L106 18 L81 31 Z" fill="var(--cyan)" stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round" />
        <circle cx="60" cy="66" r="22" fill="var(--paper-strong)" stroke="var(--ink)" strokeWidth="4" />
        <circle cx="52" cy="62" r="4" fill="var(--ink)" /><circle cx="68" cy="62" r="4" fill="var(--ink)" />
        <path d="M49 74 Q60 82 71 74" fill="none" stroke="var(--ink)" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M18 56 H34 M86 56 H102 M60 24 V12" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (variant === "signal") {
    return (
      <svg className={className} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <path d="M30 42 L18 18 L40 32 Z" fill="var(--red)" stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round" />
        <path d="M90 42 L102 18 L80 32 Z" fill="var(--violet)" stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round" />
        <rect x="30" y="39" width="60" height="50" rx="20" fill="var(--paper-strong)" stroke="var(--ink)" strokeWidth="4" />
        <circle cx="49" cy="56" r="4" fill="var(--ink)" /><circle cx="71" cy="56" r="4" fill="var(--ink)" />
        <path d="M53 70 Q60 77 67 70 M21 68 Q12 61 18 52 M21 78 Q10 74 12 63 M99 68 Q108 61 102 52 M99 78 Q110 74 108 63" fill="none" stroke="var(--ink)" strokeWidth="3.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (variant === "stack") {
    return (
      <svg className={className} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <rect x="34" y="30" width="52" height="10" fill="var(--cyan)" stroke="var(--ink)" strokeWidth="4" />
        <rect x="28" y="40" width="64" height="12" fill="var(--yellow)" stroke="var(--ink)" strokeWidth="4" />
        <rect x="24" y="52" width="72" height="34" fill="var(--paper-strong)" stroke="var(--ink)" strokeWidth="4" />
        <path d="M28 52 L18 32 L36 42 Z" fill="var(--green)" stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round" />
        <path d="M92 52 L102 32 L84 42 Z" fill="var(--red)" stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round" />
        <circle cx="48" cy="68" r="4" fill="var(--ink)" /><circle cx="72" cy="68" r="4" fill="var(--ink)" />
        <path d="M52 78 Q60 84 68 78 M36 90 H84" fill="none" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }
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
    const current = window.localStorage.getItem(PANEL_ORDER_KEY);
    if (current) return clampOrder(JSON.parse(current) as HomePanelId[]);
    const raw = LEGACY_PANEL_ORDER_KEYS.map((key) => window.localStorage.getItem(key)).find(Boolean);
    if (!raw) return DEFAULT_PANEL_ORDER;
    const parsed = JSON.parse(raw) as HomePanelId[];
    const migrated = clampOrder(parsed);
    const buddyIndex = migrated.indexOf("buddy");
    const focusIndex = migrated.indexOf("focus");
    if (buddyIndex >= 0 && focusIndex >= 0 && buddyIndex !== focusIndex + 1) {
      migrated.splice(buddyIndex, 1);
      migrated.splice(migrated.indexOf("focus") + 1, 0, "buddy");
    }
    return migrated;
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
      reminderAt: typeof item.reminderAt === "string" ? item.reminderAt : "",
      remindedAt: typeof item.remindedAt === "number" ? item.remindedAt : null,
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
  const [todoViewDate, setTodoViewDate] = useState(todayKey());
  const [todoBatchDate, setTodoBatchDate] = useState(todayKey());
  const [todoBatchReminderTime, setTodoBatchReminderTime] = useState("");
  const [todoBatchText, setTodoBatchText] = useState("");
  const [todoPraise, setTodoPraise] = useState<string | null>(null);
  const [todoReminder, setTodoReminder] = useState<TodoReminder | null>(null);
  const [todoReminderQueue, setTodoReminderQueue] = useState<TodoReminder[]>([]);
  const [todoReminderTick, setTodoReminderTick] = useState(0);
  const [pomodoroDurations, setPomodoroDurations] = useState<PomodoroDurations>(() => loadPomodoroDurations());
  const [pomodoro, setPomodoro] = useState<PomodoroState>(() => loadPomodoroState(loadPomodoroDurations()));
  const [pomodoroFinish, setPomodoroFinish] = useState<string | null>(null);
  const [buddyMessage, setBuddyMessage] = useState<string | null>(null);
  const [buddyPetted, setBuddyPetted] = useState(false);
  const [buddyBounceAlt, setBuddyBounceAlt] = useState(false);
  const [buddyMessageIndex, setBuddyMessageIndex] = useState(0);
  const [buddyWalking, setBuddyWalking] = useState(false);
  const [buddyFacingLeft, setBuddyFacingLeft] = useState(false);
  const [buddyAutoAction, setBuddyAutoAction] = useState<BuddyAutoAction>(null);
  const [scorelineRefreshKey, setScorelineRefreshKey] = useState(0);
  const todoToastTimerRef = useRef<number | null>(null);
  const todoReminderTimerRef = useRef<number | null>(null);
  const buddyTimerRef = useRef<number | null>(null);
  const buddyActionTimerRef = useRef<number | null>(null);
  const buddyStageRef = useRef<HTMLDivElement | null>(null);
  const buddyWalkerRef = useRef<HTMLDivElement | null>(null);
  const buddyMotionRef = useRef<BuddyMotion>({
    x: 0,
    direction: 1,
    walking: false,
    switchAt: 0,
    nextActionAt: 0,
    lastFrame: 0
  });
  const lastPomodoroRef = useRef({ running: pomodoro.running, remainingSeconds: pomodoro.remainingSeconds });

  useEffect(() => {
    const stage = buddyStageRef.current;
    const walker = buddyWalkerRef.current;
    if (!stage || !walker) return;

    const motion = buddyMotionRef.current;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const placeBuddy = () => {
      const maxX = Math.max(0, stage.clientWidth - walker.offsetWidth - 32);
      motion.x = Math.max(0, Math.min(motion.x, maxX));
      walker.style.transform = `translate3d(${16 + motion.x}px, 0, 0)`;
    };
    const observer = new ResizeObserver(placeBuddy);
    observer.observe(stage);
    placeBuddy();

    if (prefersReducedMotion) {
      return () => observer.disconnect();
    }

    motion.walking = false;
    motion.switchAt = performance.now() + 4200 + Math.random() * 4200;
    motion.nextActionAt = performance.now() + 7000 + Math.random() * 6000;
    motion.lastFrame = 0;
    const animate = (timestamp: number) => {
      const elapsed = motion.lastFrame ? Math.min((timestamp - motion.lastFrame) / 1000, 0.05) : 0;
      motion.lastFrame = timestamp;

      if (timestamp >= motion.switchAt) {
        motion.walking = !motion.walking;
        setBuddyWalking(motion.walking);
        // The buddy spends most of its time waiting and only takes short walks.
        const pause = 10000 + Math.random() * 8000;
        const walk = 2500 + Math.random() * 2200;
        motion.switchAt = timestamp + (motion.walking ? walk : pause);
      }

      if (!motion.walking && timestamp >= motion.nextActionAt) {
        setBuddyAutoAction(Math.random() < 0.55 ? "wave" : "hop");
        if (buddyActionTimerRef.current !== null) window.clearTimeout(buddyActionTimerRef.current);
        buddyActionTimerRef.current = window.setTimeout(() => {
          setBuddyAutoAction(null);
          buddyActionTimerRef.current = null;
        }, 1250);
        motion.nextActionAt = timestamp + 12000 + Math.random() * 12000;
      }

      if (motion.walking) {
        const maxX = Math.max(0, stage.clientWidth - walker.offsetWidth - 32);
        motion.x += motion.direction * 38 * elapsed;
        if (motion.x >= maxX) {
          motion.x = maxX;
          motion.direction = -1;
          setBuddyFacingLeft(true);
        } else if (motion.x <= 0) {
          motion.x = 0;
          motion.direction = 1;
          setBuddyFacingLeft(false);
        }
      }

      placeBuddy();
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

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
    if (todoReminderTimerRef.current !== null) {
      window.clearTimeout(todoReminderTimerRef.current);
      todoReminderTimerRef.current = null;
    }
    const now = Date.now();
    const pending = sortTodoItems(todoItems.filter((item) => {
      if (!item.reminderAt || item.done || item.remindedAt !== null) return false;
      const timestamp = parseDateTimeValue(item.reminderAt);
      return timestamp !== null && timestamp <= now;
    }));
    if (pending.length > 0) {
      const pendingIds = new Set(pending.map((item) => item.id));
      const remindedAt = Date.now();
      setTodoItems((current) => current.map((item) => pendingIds.has(item.id) ? { ...item, remindedAt } : item));
      setTodoReminderQueue((current) => normalizeTodoReminderQueue([...current, ...pending.map(getReminderPayload)]));
      return;
    }
    const upcoming = sortTodoItems(todoItems.filter((item) => {
      if (!item.reminderAt || item.done || item.remindedAt !== null) return false;
      return parseDateTimeValue(item.reminderAt) !== null;
    })).find((item) => {
      const timestamp = parseDateTimeValue(item.reminderAt);
      return timestamp !== null && timestamp > now;
    });
    if (!upcoming) return;
    const timestamp = parseDateTimeValue(upcoming.reminderAt);
    if (timestamp === null) return;
    todoReminderTimerRef.current = window.setTimeout(() => {
      setTodoReminderTick((value) => value + 1);
    }, Math.max(0, timestamp - now) + 40);
  }, [todoItems, todoReminderTick]);

  useEffect(() => {
    if (todoReminder || todoReminderQueue.length === 0) return;
    const [nextReminder, ...rest] = todoReminderQueue;
    setTodoReminder(nextReminder);
    setTodoReminderQueue(rest);
  }, [todoReminder, todoReminderQueue]);

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
      if (todoReminderTimerRef.current !== null) {
        window.clearTimeout(todoReminderTimerRef.current);
      }
      if (buddyTimerRef.current !== null) {
        window.clearTimeout(buddyTimerRef.current);
      }
      if (buddyActionTimerRef.current !== null) {
        window.clearTimeout(buddyActionTimerRef.current);
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
  const todoVisibleItems = useMemo(
    () => sortTodoItems(todoItems.filter((item) => item.date === todoViewDate)),
    [todoItems, todoViewDate]
  );
  const todoVisibleDoneCount = todoVisibleItems.filter((item) => item.done).length;
  const todoVisiblePendingCount = todoVisibleItems.length - todoVisibleDoneCount;
  const todoVisibleReminderCount = todoVisibleItems.filter((item) => item.reminderAt && !item.done).length;
  const todoViewLabel = formatTodoGroupLabel(todoViewDate);
  const todoTotalCount = todoItems.length;
  const todoDayCount = todoGroups.length;
  const todayTodoItems = useMemo(() => todoItems.filter((item) => item.date === todayKey()), [todoItems]);
  const todayTodoPendingCount = todayTodoItems.filter((item) => !item.done).length;
  const todayReminderCount = todayTodoItems.filter((item) => item.reminderAt && !item.done).length;
  const pomodoroTotal = getModeSeconds(pomodoro.mode, pomodoroDurations);
  const pomodoroProgress = Math.max(0, Math.min(1, 1 - pomodoro.remainingSeconds / Math.max(1, pomodoroTotal)));
  const pomodoroStatus = pomodoro.running
    ? "计时中"
    : pomodoro.remainingSeconds <= 0
      ? "已结束"
      : "已暂停";

  function handleDragStart(id: HomePanelId, event: DragEvent<HTMLElement>): void {
    event.stopPropagation();
    setDragging(id);
    event.dataTransfer.setData("text/plain", id);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(event: DragEvent<HTMLElement>): void {
    if (!dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleDrop(targetId: HomePanelId, event: DragEvent<HTMLElement>): void {
    event.preventDefault();
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

  function addTodoItem(): void {
    setTodoItems((current) => [...current, createTodoItem("", todoViewDate)]);
  }

  function updateTodoTextById(id: string, text: string): void {
    setTodoItems((current) => current.map((item) => (item.id === id ? { ...item, text } : item)));
  }

  function toggleTodoDoneById(id: string, done: boolean): void {
    const previous = todoItems.find((item) => item.id === id);
    setTodoItems((current) => current.map((item) => item.id === id ? { ...item, done, remindedAt: done ? Date.now() : item.remindedAt } : item));
    if (done) {
      setTodoReminder((current) => current?.id === id ? null : current);
      setTodoReminderQueue((current) => current.filter((item) => item.id !== id));
    }
    if (previous && !previous.done && done) {
      pushTodoPraise();
    }
  }

  function updateTodoDateById(id: string, date: string): void {
    const nextDate = date || todayKey();
    setTodoItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const reminderTime = toLocalTimeValue(item.reminderAt);
      const nextReminderAt = reminderTime ? buildReminderAt(nextDate, reminderTime) : item.reminderAt;
      return {
        ...item,
        date: nextDate,
        reminderAt: nextReminderAt,
        remindedAt: nextReminderAt !== item.reminderAt ? null : item.remindedAt
      };
    }));
  }

  function updateTodoReminderById(id: string, time: string): void {
    setTodoItems((current) => current.map((item) => item.id === id ? {
      ...item,
      reminderAt: time ? buildReminderAt(item.date, time) : "",
      remindedAt: null
    } : item));
  }

  function deleteTodoItemById(id: string): void {
    setTodoItems((current) => current.filter((item) => item.id !== id));
    setTodoReminder((current) => current?.id === id ? null : current);
    setTodoReminderQueue((current) => current.filter((item) => item.id !== id));
  }

  function shiftTodoViewDate(days: number): void {
    setTodoViewDate((current) => shiftDate(current || todayKey(), days));
  }

  function syncBatchDateToViewDate(): void {
    setTodoBatchDate(todoViewDate);
  }

  function addTodoBatch(): void {
    const lines = splitTodoLines(todoBatchText);
    if (!lines.length) return;
    const date = todoBatchDate || todoViewDate || todayKey();
    const reminderAt = buildReminderAt(date, todoBatchReminderTime);
    const stamp = Date.now();
    setTodoItems((current) => [
      ...current,
      ...lines.map((text, index) => ({
        id: `todo-${stamp}-${Math.random().toString(36).slice(2, 8)}-${index}`,
        text,
        date,
        reminderAt,
        remindedAt: null,
        done: false,
        createdAt: stamp + index
      }))
    ]);
    setTodoBatchText("");
    setTodoBatchDate(date);
    setTodoViewDate(date);
  }

  function dismissTodoReminder(): void {
    setTodoReminder(null);
  }

  function snoozeTodoReminder(minutes = 10): void {
    if (!todoReminder) return;
    const nextDateTime = new Date(Date.now() + minutes * 60_000);
    const nextDate = todayKey(nextDateTime);
    const nextTime = `${String(nextDateTime.getHours()).padStart(2, "0")}:${String(nextDateTime.getMinutes()).padStart(2, "0")}`;
    const nextReminderAt = buildReminderAt(nextDate, nextTime);
    setTodoItems((current) => current.map((item) => item.id === todoReminder.id ? {
      ...item,
      date: toLocalDateValue(nextReminderAt) || nextDate,
      reminderAt: nextReminderAt,
      remindedAt: null
    } : item));
    setTodoReminder(null);
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

  function interactWithBuddy(): void {
    setBuddyAutoAction(null);
    if (buddyActionTimerRef.current !== null) {
      window.clearTimeout(buddyActionTimerRef.current);
      buddyActionTimerRef.current = null;
    }
    setBuddyMessage(BUDDY_MESSAGES[buddyMessageIndex] ?? BUDDY_MESSAGES[0]);
    setBuddyMessageIndex((index) => (index + 1) % BUDDY_MESSAGES.length);
    setBuddyBounceAlt((current) => !current);
    setBuddyPetted(true);
    if (buddyTimerRef.current !== null) window.clearTimeout(buddyTimerRef.current);
    buddyTimerRef.current = window.setTimeout(() => {
      setBuddyMessage(null);
      setBuddyPetted(false);
      buddyTimerRef.current = null;
    }, 2200);
  }

  function renderPanel(id: HomePanelId): JSX.Element {
    const meta = panelMeta[id];
    const isDefaultPanelLayout = panelOrder.length === DEFAULT_PANEL_ORDER.length && panelOrder.every((panelId, index) => panelId === DEFAULT_PANEL_ORDER[index]);
    return (
      <section
        key={id}
        className={`home-panel home-panel-${id} panel ${isDefaultPanelLayout ? "home-panel-default-layout" : ""} ${id === "target" || id === "feed" || id === "banks" ? "home-panel-span-2" : ""} ${id === "buddy" ? "home-panel-buddy" : ""} ${
          dragging === id ? "is-dragging" : ""
        }`}
        onDragOver={handleDragOver}
        onDrop={(event) => handleDrop(id, event)}
      >
        {id !== "buddy" ? (
          <div className="home-panel-head">
            <div>
              <div className="section-kicker">{meta.kicker}</div>
              <div className="home-panel-title">
                <span className="home-panel-icon">{meta.icon}</span>
                <h2>{meta.title}</h2>
              </div>
            </div>
            <button
              type="button"
              className="home-panel-grip"
              draggable
              onDragStart={(event) => handleDragStart(id, event)}
              onDragEnd={() => setDragging(null)}
              aria-label={meta.title}
              title="drag to reorder"
            >
              <GripVertical size={16} />
            </button>
          </div>
        ) : (
          <div className="home-panel-buddy-handle">
            <button
              type="button"
              className="home-panel-grip"
              draggable
              onDragStart={(event) => handleDragStart(id, event)}
              onDragEnd={() => setDragging(null)}
              aria-label={meta.title}
              title="drag to reorder"
            >
              <GripVertical size={16} />
            </button>
          </div>
        )}

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

        {id === "buddy" && (
          <div className="home-panel-body home-buddy">
            <div className="home-buddy-stage" ref={buddyStageRef}>
              <div className="home-buddy-walker" ref={buddyWalkerRef}>
                <button
                  type="button"
                  className={`home-buddy-avatar ${buddyWalking ? "is-walking" : ""} ${buddyFacingLeft ? "is-facing-left" : ""} ${buddyAutoAction ? `is-auto-action is-auto-${buddyAutoAction}` : ""} ${buddyPetted ? `is-petted ${buddyBounceAlt ? "is-petted-alt" : ""}` : ""}`}
                  onClick={interactWithBuddy}
                  aria-label="点击互动，拖动卡片调整桌宠位置"
                  title="点击互动，也可以拖动卡片调整位置"
                >
                  <video
                    key={`${buddyPetted ? "click" : buddyAutoAction ? buddyAutoAction : buddyWalking ? "walk" : "idle"}-${buddyBounceAlt}`}
                    className="home-buddy-video"
                    src={buddyPetted || buddyAutoAction ? BUDDY_ASSETS.click : buddyWalking ? BUDDY_ASSETS.walk : BUDDY_ASSETS.idle}
                    aria-hidden="true"
                    autoPlay
                    muted
                    playsInline
                    loop={!buddyPetted && !buddyAutoAction}
                    preload="auto"
                    onLoadedData={(event) => {
                      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches && !buddyPetted) {
                        event.currentTarget.pause();
                      }
                    }}
                  />
                </button>
                {buddyMessage ? <span className="home-buddy-speech" role="status">{buddyMessage}</span> : null}
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
                <span>{todoViewLabel} · 当前 {todoVisibleItems.length} 条 · 已完成 {todoVisibleDoneCount} · 待办 {todoVisiblePendingCount} · 提醒 {todoVisibleReminderCount} 条 · 总计 {todoTotalCount} 条 / {todoDayCount} 天</span>
              </div>
              <div className="home-todo-toolbar-actions">
                <label className="home-todo-field home-todo-date-picker home-todo-toolbar-date">
                  <span>当前日期</span>
                  <input type="date" value={todoViewDate} onChange={(event) => setTodoViewDate(event.target.value || todayKey())} />
                </label>
                <div className="home-todo-toolbar-nav">
                  <button type="button" className="outline-action" onClick={() => shiftTodoViewDate(-1)}><ChevronLeft size={16} />前一天</button>
                  <button type="button" className="outline-action" onClick={() => setTodoViewDate(todayKey())}>今天</button>
                  <button type="button" className="outline-action" onClick={() => shiftTodoViewDate(1)}>后一天<ChevronRight size={16} /></button>
                </div>
              </div>
            </div>

            <div className="home-todo-date-hints home-todo-date-hints-strip">
              {todoGroups.slice(0, 6).map((group) => (
                <button type="button" className={`home-todo-date-chip ${group.date === todoViewDate ? "is-active" : ""}`} onClick={() => setTodoViewDate(group.date)} key={group.date}>
                  <span>{formatTodoGroupLabel(group.date)}</span><small>{group.items.length}</small>
                </button>
              ))}
            </div>

            <div className="home-todo-compose">
              <div className="home-todo-compose-head">
                <div><strong>批量录入</strong><span>每行一条，统一日期，也能顺手带上提醒时间。</span></div>
                <button type="button" className="outline-action" onClick={syncBatchDateToViewDate}>使用当前日期</button>
              </div>
              <div className="home-todo-compose-grid">
                <label className="home-todo-field home-todo-compose-text">
                  <span>待办内容</span>
                  <textarea value={todoBatchText} onChange={(event) => setTodoBatchText(event.target.value)} placeholder={'每行一条，比如\n背英语作文\n整理专业课笔记'} />
                </label>
                <label className="home-todo-field"><span>日期</span><input type="date" value={todoBatchDate} onChange={(event) => setTodoBatchDate(event.target.value || todayKey())} /></label>
                <label className="home-todo-field"><span><Clock3 size={12} />提醒时间</span><input type="time" value={todoBatchReminderTime} onChange={(event) => setTodoBatchReminderTime(event.target.value)} /></label>
                <div className="home-todo-compose-actions">
                  <button type="button" className="primary-action compact" onClick={addTodoBatch}><Plus size={16} />批量加入</button>
                  <button type="button" className="outline-action" onClick={addTodoItem}>新增一条</button>
                </div>
              </div>
            </div>

            {todoVisibleItems.length === 0 ? (
              <div className="home-todo-empty">这一天还没排任务，先批量放几条进去。</div>
            ) : (
              <div className="home-todo-list">
                {todoVisibleItems.map((item, index) => (
                  <div className={`home-todo-item ${item.done ? "is-done" : ""}`} key={item.id}>
                    <div className="home-todo-item-main">
                      <input type="checkbox" checked={item.done} onChange={(event) => toggleTodoDoneById(item.id, event.target.checked)} aria-label={`完成待办 ${index + 1}`} />
                      <input type="text" value={item.text} onChange={(event) => updateTodoTextById(item.id, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTodoItem(); } }} placeholder="写下今天要做的事" />
                      <button type="button" className="home-todo-delete" onClick={() => deleteTodoItemById(item.id)} aria-label={`删除待办 ${index + 1}`}><Trash2 size={16} /></button>
                    </div>
                    <div className="home-todo-item-meta">
                      <label className="home-todo-field"><span>日期</span><input type="date" value={item.date} onChange={(event) => updateTodoDateById(item.id, event.target.value)} /></label>
                      <label className="home-todo-field"><span>提醒</span><input type="time" value={toLocalTimeValue(item.reminderAt)} onChange={(event) => updateTodoReminderById(item.id, event.target.value)} /></label>
                      <div className="home-todo-item-status">{item.done ? "已完成" : item.reminderAt ? (item.remindedAt ? `已提醒 · ${formatTodoReminderLabel(item.reminderAt)}` : formatTodoReminderLabel(item.reminderAt)) : "未设提醒"}</div>
                    </div>
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
      <DesktopPetControls />
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

      {todoReminder ? (
        <div className="home-modal-overlay home-reminder-overlay" role="presentation">
          <div className="home-modal home-reminder-modal" role="dialog" aria-modal="true" aria-label="待办提醒">
            <div className="home-modal-cat home-reminder-cat">
              <AbstractCatMark className="home-cat-art home-cat-art-modal" variant={todoReminder.variant} />
            </div>
            <div className="home-modal-copy">
              <div className="section-kicker"><AlarmClock size={14} />REMINDER</div>
              <strong>{todoReminder.message}</strong>
              <p>{todoReminder.text || "有一条待办到点了，先处理一下。"}</p>
              <small>{formatTodoReminderLabel(todoReminder.reminderAt)} · {todoReminderQueue.length ? `队列里还有 ${todoReminderQueue.length} 条` : "这一条先到了"}</small>
            </div>
            <div className="home-modal-actions">
              <button type="button" className="primary-action compact" onClick={() => snoozeTodoReminder(10)}>延后 10 分钟</button>
              <button type="button" className="outline-action" onClick={dismissTodoReminder}>知道了</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
