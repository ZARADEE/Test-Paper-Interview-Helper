import { useEffect, useState } from "react";
import { API_BASE } from "../api";
import type { PracticeSession, Question } from "../types";

export type KnowledgeCard = { id: string; title: string; subject: string; question_bank_id: string; major: string; question_ids: string[]; attempts: number; correct: number; examples: { question_id: string; text: string }[] };
type Overview = { cards: KnowledgeCard[]; favorites: string[]; sessions: (PracticeSession & { correct_count: number })[]; stats: { attempts: number; correct: number } };
type Discussion = { id: string; nickname: string; body: string; parent_id: string | null; liked: number };
export async function learningRequest<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(`${API_BASE}/learning${path}`, body === undefined ? undefined : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "学习记录操作失败");
  return payload as T;
}

export function LearningPanel({ revision, onPractice, onResume }: { revision: number; onPractice: (card: KnowledgeCard, ids?: string[]) => void; onResume: (id: string) => void }): JSX.Element {
  const [data, setData] = useState<Overview>();
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => { let active = true; learningRequest<Overview>("/overview").then(value => { if (active) setData(value); }).catch(e => { if (active) setError(String(e)); }); return () => { active = false; }; }, [revision]);
  const card = data?.cards.find(item => item.id === selected);
  const cards = data?.cards.filter(item => `${item.subject} ${item.major} ${item.title}`.includes(search.trim()) && (view !== "weak" || (item.attempts > item.correct)) && (view !== "favorites" || item.question_ids.some(id => data.favorites.includes(id)))) ?? [];
  return <section className="learning-panel panel">
    <div className="section-kicker">LEARN / PRACTICE / REFLECT</div><h2>知识地图与学习记录</h2>
    {error && <p role="alert">{error}</p>}
    <p>累计作答 {data?.stats.attempts ?? 0} 次 · 正确率 {data?.stats.attempts ? Math.round(data.stats.correct / data.stats.attempts * 100) + "%" : "暂无记录"} · 收藏 {data?.favorites.length ?? 0} 题</p>
    <div className="learning-controls"><input aria-label="搜索知识点" placeholder="搜索学科、章节、知识点" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="知识点筛选" value={view} onChange={e => setView(e.target.value)}><option value="all">全部知识点</option><option value="weak">薄弱知识点</option><option value="favorites">收藏关联</option></select></div>
    <div className="knowledge-tree">{[...new Set(cards.map(item => item.subject))].map(subject => <details key={subject} open={Boolean(search) || undefined}><summary>{subject} · {cards.filter(item => item.subject === subject).length} 个知识点</summary>{[...new Set(cards.filter(item => item.subject === subject).map(item => item.major))].map(major => <details key={major} open={Boolean(search) || undefined}><summary>{major}</summary>{cards.filter(item => item.subject === subject && item.major === major).map(item => <button className={selected === item.id ? "is-active" : ""} type="button" key={item.id} onClick={() => setSelected(item.id)}>{item.title}<small>{item.question_ids.length} 题 · {item.attempts ? Math.round(item.correct / item.attempts * 100) + "%" : "未练习"}</small></button>)}</details>)}</details>)}</div>
    {!cards.length && <p className="muted-copy">暂无匹配知识点。知识地图来自当前已审核题库。</p>}
    {card && <article className="knowledge-card"><h3>{card.title}</h3><p>{card.subject} / {card.major}</p><div className="toolbar-actions"><button type="button" onClick={() => onPractice(card)}>专项补弱 / 练习此知识点</button>{card.question_ids.some(id => data?.favorites.includes(id)) && <button type="button" onClick={() => onPractice(card, card.question_ids.filter(id => data?.favorites.includes(id)))}>练习收藏题</button>}</div><h4>题库解析摘录</h4>{card.examples.map(example => <p className="question-text" key={example.question_id}>{example.text}</p>)}{!card.examples.length && <p>当前题库未提供此知识点的解析内容。</p>}<CardDiscussion key={card.id} cardId={card.id} /></article>}
    <details className="learning-history"><summary>最近练习 / 恢复作答（最多 50 组）</summary>{data?.sessions.map(item => <div key={item.id}><span>{item.subject} · {item.answered_count}/{item.total_count} 已答 · 答对 {item.correct_count} · {new Date(item.created_at).toLocaleString()}</span><button type="button" onClick={() => onResume(item.id)}>{item.completed_at ? "复盘" : "继续作答"}</button></div>)}</details>
  </section>;
}

function CardDiscussion({ cardId }: { cardId: string }): JSX.Element {
  const [items, setItems] = useState<Discussion[]>([]);
  const [name, setName] = useState("学习者");
  const [body, setBody] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = () => learningRequest<Discussion[]>(`/cards/${cardId}/discussions`).then(setItems);
  useEffect(() => { void reload().catch(e => setError(String(e))); }, [cardId]);
  async function send(): Promise<void> { setBusy(true); try { setItems(await learningRequest<Discussion[]>(`/cards/${cardId}/discussions`, { nickname: name, body, parent_id: parent })); setBody(""); setParent(null); setError(""); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  async function react(id: string, action: string): Promise<void> { try { await learningRequest(`/discussions/${id}/${action}`, {}); await reload(); } catch (e) { setError(String(e)); } }
  return <details><summary>知识卡讨论（保存在本机）</summary><p className="muted-copy">本地交流笔记，不提供跨设备同步。点赞最高的回复置顶。</p>{[...items].sort((a,b) => b.liked - a.liked).map(item => <article className="discussion-item" key={item.id}><strong>{item.nickname}{item.parent_id ? " · 回复" : " · 提问"}{item.liked ? " · 推荐" : ""}</strong><p>{item.body}</p><button type="button" onClick={() => setParent(item.id)}>回复</button><button type="button" onClick={() => void react(item.id, "like")}>{item.liked ? "取消赞" : "赞"}</button><button type="button" onClick={() => void react(item.id, "report")}>举报并隐藏</button></article>)}<p>讨论概览：{items.filter(i => !i.parent_id).length} 个提问，{items.filter(i => i.parent_id).length} 条回复。</p><form onSubmit={e => { e.preventDefault(); void send(); }}><label><span>昵称</span><input required maxLength={40} value={name} onChange={e => setName(e.target.value)} /></label><label><span>{parent ? "回复内容" : "提问或笔记"}</span><textarea required maxLength={2000} value={body} onChange={e => setBody(e.target.value)} /></label>{parent && <button type="button" onClick={() => setParent(null)}>取消回复</button>}<button type="submit" disabled={busy}>保存到本机</button>{error && <p role="alert">{error}</p>}</form></details>;
}

export function QuestionReflection({ question, onChanged, onPractice }: { question: Question; onChanged: () => void; onPractice: (question: Question) => void }): JSX.Element {
  const [note, setNote] = useState({ favorite: false, cause: "", note: "" });
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => { let active = true; learningRequest<typeof note>(`/notes/${question.id}`).then(value => { if (active) { setNote(value); setReady(true); } }).catch(e => setMessage(String(e))); return () => { active = false; }; }, [question.id]);
  async function save(): Promise<void> { try { await learningRequest(`/notes/${question.id}`, note, "PUT"); setMessage("已保存"); onChanged(); } catch (e) { setMessage(String(e)); } }
  return <div className="question-reflection"><h4>错因复盘与知识回溯</h4><p>{[...question.tags, ...question.knowledge_points].join(" / ")}</p><label className="agent-toggle"><span>收藏此题</span><input type="checkbox" disabled={!ready} checked={Boolean(note.favorite)} onChange={e => setNote({ ...note, favorite: e.target.checked })} /></label><label><span>我的错因（自评）</span><select value={note.cause} onChange={e => setNote({ ...note, cause: e.target.value })}><option value="">请选择</option>{["概念不清", "方法不熟", "计算失误", "审题疏漏", "知识遗忘"].map(cause => <option key={cause}>{cause}</option>)}</select></label><textarea aria-label="复盘笔记" maxLength={2000} value={note.note} onChange={e => setNote({ ...note, note: e.target.value })} /><div className="toolbar-actions"><button type="button" disabled={!ready} onClick={() => void save()}>保存复盘</button><button type="button" onClick={() => onPractice(question)}>同知识点专项训练</button></div><span role="status">{message}</span></div>;
}
