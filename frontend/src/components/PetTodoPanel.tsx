import { useEffect, useState } from "react";
import { CheckCheck, ListTodo, X } from "lucide-react";
import { ReviewTask, useReviewSummary } from "./ReviewTask";

const TODO_KEY = "paper-helper.home.todo-notebook.v1";
type Todo = { id: string; text: string; date: string; done: boolean; reminderAt?: string };

function today(): string {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function readToday(): Todo[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(TODO_KEY) || "[]");
    if (!Array.isArray(values)) return [];
    return values.filter((item): item is Todo => Boolean(item && typeof item.id === "string" && typeof item.text === "string" && item.text.trim() && item.date === today()))
      .sort((a, b) => (a.reminderAt || "~").localeCompare(b.reminderAt || "~"));
  } catch { return []; }
}

export function PetTodoPanel(): JSX.Element {
  const [items, setItems] = useState(readToday);
  const reviewProgress=useReviewSummary();
  useEffect(() => {
    const refresh = () => setItems(readToday());
    const onStorage = (event: StorageEvent) => { if (event.key === TODO_KEY || event.key === null) refresh(); };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => { window.removeEventListener("storage", onStorage); document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
  }, []);
  const pending = items.filter(item => !item.done);
  return <main className="pet-todo-panel" onKeyDown={event => { if (event.key === "Escape") window.paperHelper?.hidePetTodos(); }}>
    <header><div><small>TODAY / 待办事项</small><h1><ListTodo size={22} />今日剩余 <b>{pending.length+(reviewProgress.summary?.remaining?1:0)}</b></h1></div><button type="button" aria-label="关闭待办面板" onClick={() => window.paperHelper?.hidePetTodos()}><X size={19} /></button></header>
    <p className="pet-todo-summary">{today()} · 手动待办已完成 {items.length - pending.length} / {items.length}</p>
    <section className="pet-todo-scroll" aria-label="今日未完成事项">
      <ReviewTask {...reviewProgress} compact />
      {pending.length ? <ul>{pending.map(item => <li key={item.id}><span className="pet-todo-marker" /><div><p>{item.text}</p>{item.reminderAt && <small>{new Date(item.reminderAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small>}</div></li>)}</ul> : !reviewProgress.summary?.total&&<div className="pet-todo-empty"><CheckCheck size={34} /><strong>{items.length ? "手动待办已完成" : "今天还没有手动待办"}</strong><span>{items.length ? "休息一下，做得不错。" : "去学习台安排今天的任务。"}</span></div>}
    </section>
    <footer><button type="button" onClick={() => window.paperHelper?.showMain()}>打开学习台管理待办</button></footer>
  </main>;
}
