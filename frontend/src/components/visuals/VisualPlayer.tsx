import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { CwndVisual, PipelineVisual, SortVisual, TreeVisual } from "./kinds-a";
import { FlowVisual, GraphVisual, PagesVisual, SeqVisual } from "./kinds-b";
import { simulatePages } from "./pages-sim";
import type { VisualSpec } from "./types";
import "./visuals.css";

export const VISUAL_LABELS: Record<VisualSpec["kind"], string> = { sort: "数组与排序", tree: "树构造", graph: "图算法", pages: "页面置换", cwnd: "拥塞控制", pipeline: "指令流水线", seq: "协议时序", flow: "流程图" };
class DiagramBoundary extends Component<{children:ReactNode}, {failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  render() { return this.state.failed ? <p role="alert">图解数据无法显示，请查看文字解析并反馈题号。</p> : this.props.children; }
}
export function VisualPlayer({spec, active=true}:{spec:VisualSpec; active?:boolean}):JSX.Element {
  return <DiagramBoundary key={JSON.stringify(spec)}><Player spec={spec} active={active} /></DiagramBoundary>;
}
function Player({spec,active}:{spec:VisualSpec;active:boolean}):JSX.Element {
  const [step,setStep]=useState(0);
  const [playing,setPlaying]=useState(false);
  const total=spec.kind==="flow"?0:spec.kind==="sort"?spec.frames.length:spec.kind==="pages"?spec.accesses.length:spec.kind==="cwnd"?spec.points.length:spec.kind==="pipeline"?spec.instrs.length:spec.kind==="seq"?spec.messages.length:spec.steps.length;
  const pageSteps=useMemo(()=>spec.kind==="pages" && Number.isInteger(spec.frames) && spec.frames>0 && spec.frames<=128?simulatePages(spec):[],[spec]);
  useEffect(()=>{setStep(0);setPlaying(false);},[spec]);
  useEffect(()=>{if(!active)setPlaying(false);},[active]);
  useEffect(()=>{if(!playing||!active)return;const timer=window.setInterval(()=>setStep(s=>{if(s>=total-1){setPlaying(false);return s;}return s+1;}),1600);return()=>window.clearInterval(timer);},[playing,total,active]);
  useEffect(()=>{const pause=()=>{if(document.hidden)setPlaying(false);};document.addEventListener("visibilitychange",pause);return()=>document.removeEventListener("visibilitychange",pause);},[]);
  if(!(spec.kind in VISUAL_LABELS)||spec.kind!=="flow"&&!total||spec.kind==="pages"&&(!Number.isInteger(spec.frames)||spec.frames<1||spec.frames>128))return <p role="alert">图解缺少有效步骤，请查看文字解析。</p>;
  const current=Math.min(step,Math.max(0,total-1));
  const note=spec.kind==="sort"?spec.frames[current]?.note:spec.kind==="tree"||spec.kind==="graph"?spec.steps[current]?.note:spec.kind==="pages"?pageSteps[current]?.note:spec.kind==="cwnd"?`第 ${spec.points[current]?.round} 轮：cwnd=${spec.points[current]?.cwnd} MSS；ssthresh=${spec.points[current]?.ssthresh??"沿用前值"} ${spec.points[current]?.event??""}`:spec.kind==="pipeline"?spec.instrs[current]?.note??`${spec.instrs[current]?.name} 于第 ${spec.instrs[current]?.delay+1} 拍进入流水线`:spec.kind==="seq"?`${spec.messages[current]?.from} → ${spec.messages[current]?.to}：${spec.messages[current]?.label}`:"按箭头阅读流程与分支";
  const go=(n:number)=>{setPlaying(false);setStep(Math.max(0,Math.min(n,total-1)));};
  return <section className="visual-player" data-visual={spec.kind}><header><strong>{spec.title}</strong><span>{VISUAL_LABELS[spec.kind]} · {spec.kind==="flow"?"静态图解":"逐步图解"}</span></header><div className="visual-canvas">{spec.kind==="sort"?<SortVisual frames={spec.frames} step={current}/>:spec.kind==="tree"?<TreeVisual steps={spec.steps} step={current}/>:spec.kind==="graph"?<GraphVisual spec={spec} step={current}/>:spec.kind==="pages"?<PagesVisual spec={spec} step={current}/>:spec.kind==="cwnd"?<CwndVisual points={spec.points} step={current}/>:spec.kind==="pipeline"?<PipelineVisual spec={spec} step={current}/>:spec.kind==="seq"?<SeqVisual spec={spec} step={current}/>:<FlowVisual spec={spec}/>}</div><p className="visual-note" aria-live="polite">{total>0&&<b>步骤 {current+1}/{total}　</b>}{note}</p>{total>1&&<div className="visual-controls"><button onClick={()=>go(0)} disabled={current===0} aria-label="回到第一步">首步</button><button onClick={()=>go(current-1)} disabled={current===0}>上一步</button><button onClick={()=>{if(current===total-1)setStep(0);setPlaying(p=>!p);}} aria-label={playing?"暂停":"播放"}>{playing?"暂停":"播放"}</button><button onClick={()=>go(current+1)} disabled={current===total-1}>下一步</button><button onClick={()=>go(total-1)} disabled={current===total-1}>末步</button><input aria-label="图解进度" type="range" min={0} max={total-1} step={1} value={current} onChange={e=>go(Number(e.target.value))}/></div>}</section>;
}
