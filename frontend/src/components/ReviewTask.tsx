import { useEffect, useState } from "react";
import { reviewJson, reviewRequest, type ReviewItem, type ReviewSummary } from "../reviewApi";
import "./review.css";

export const REVIEW_CHANGED="paper-helper-review-changed";
export const OPEN_REVIEW="paper-helper-open-review";
export function notifyReviews():void{
  window.dispatchEvent(new Event(REVIEW_CHANGED));
  try{localStorage.setItem(REVIEW_CHANGED,String(Date.now()));}catch{/* Polling also synchronizes windows. */}
}
export function openReviews():void{
  if(new URLSearchParams(location.search).get("surface")==="todos"&&window.paperHelper){window.paperHelper.openReview();return;}
  window.dispatchEvent(new Event(OPEN_REVIEW));
}
export function useReviewSummary():{summary:ReviewSummary|null;error:string}{
  const [summary,setSummary]=useState<ReviewSummary|null>(null),[error,setError]=useState("");
  useEffect(()=>{let live=true,running=false;
    const refresh=async()=>{if(running)return;running=true;try{const data=await reviewRequest<ReviewSummary>("/reviews/summary");if(live){setSummary(data);setError("");}}catch(e){if(live)setError(String(e));}finally{running=false;}};
    const storage=(e:StorageEvent)=>{if(e.key===REVIEW_CHANGED)void refresh();};
    void refresh();const timer=window.setInterval(()=>void refresh(),15000);
    window.addEventListener(REVIEW_CHANGED,refresh);window.addEventListener("storage",storage);window.addEventListener("focus",refresh);
    return()=>{live=false;clearInterval(timer);window.removeEventListener(REVIEW_CHANGED,refresh);window.removeEventListener("storage",storage);window.removeEventListener("focus",refresh);};
  },[]);return {summary,error};
}
export function ReviewTask({summary,error="",compact=false}:{summary:ReviewSummary|null;error?:string;compact?:boolean}):JSX.Element{
  return <article className={`review-todo ${compact?"is-compact":""}`} data-review-task={summary?.task_id}>
    <div><strong>{summary?.total===0?"安排间隔复习":summary?.completed?"今日复习已完成":"今日到期复习"}</strong>
    <span>{error?"复习服务暂不可用，进度未同步":summary?`剩余 ${summary.remaining} 项 · 已复习 ${summary.reviewed} 项${summary.deferred?` · 另有 ${summary.deferred} 项受每日限额限制`:""}`:"正在同步复习进度…"}</span>
    {!compact&&summary&&<small>{summary.date} · {summary.timezone} · {summary.ready} 项可立即开始{summary.upcoming?`，${summary.upcoming} 项稍后到期`:""}</small>}</div>
    <button type="button" onClick={openReviews}>{summary?.ready?"开始复习":"查看复习计划"}</button>
  </article>;
}
export function ReviewReminder():JSX.Element|null{
  const {summary}=useReviewSummary();const [visible,setVisible]=useState(false);
  useEffect(()=>{if(!summary?.reminders_enabled||!summary.ready){setVisible(false);return;}
    const key="paper-helper.review-reminder."+summary.task_id;
    try{if(localStorage.getItem(key))return;localStorage.setItem(key,"shown");}catch{return;}
    setVisible(true);
  },[summary?.task_id,summary?.ready,summary?.reminders_enabled]);
  if(!visible)return null;
  return <aside className="review-reminder" role="status"><strong>今天有 {summary?.ready} 项到期复习</strong><button onClick={()=>{setVisible(false);openReviews();}}>去复习</button><button aria-label="关闭本次复习提醒" onClick={()=>setVisible(false)}>关闭</button></aside>;
}
export function AddReviewButton({sourceId,sourceType="question"}:{sourceId:string;sourceType?:"question"|"knowledge"}):JSX.Element{
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{setMessage("");},[sourceId]);
  async function add(){setBusy(true);try{const row=await reviewJson<ReviewItem>("/reviews/items",{source_id:sourceId,source_type:sourceType});setMessage(row.suspended?"已在计划中，当前暂停；可在复习管理中恢复。":"已加入复习计划，重复添加不会重置进度。");notifyReviews();}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  return <div className="review-add"><button disabled={busy} onClick={()=>void add()}>{busy?"正在加入…":"加入复习计划"}</button><small role="status">{message}</small></div>;
}
