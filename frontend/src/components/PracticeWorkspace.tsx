import { useEffect, useState } from "react";
import { PracticeView } from "./PracticeView";
import { SubjectivePractice } from "./SubjectivePractice";
import { StudyLibrary } from "./StudyLibrary";
import { ReviewQueue } from "./ReviewQueue";
import { OPEN_REVIEW } from "./ReviewTask";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import "./study.css";
type Mode="choice"|"subjective"|"knowledge"|"diagrams"|"review";
export function PracticeWorkspace({active}:{active:boolean}):JSX.Element {
  const [mode,setMode]=useState<Mode>("choice"),[subjectiveVisited,setSubjectiveVisited]=useState(false);
  function choose(next:Mode):void{setMode(next);if(next==="subjective")setSubjectiveVisited(true);}
  useEffect(()=>{const open=()=>setMode("review");window.addEventListener(OPEN_REVIEW,open);return()=>window.removeEventListener(OPEN_REVIEW,open);},[]);
  return <div className="practice-workspace"><nav className="study-tabs practice-mode-tabs" aria-label="小题狂练功能">{([["choice","选择题练习"],["subjective","主观题练习"],["review","到期复习"],["knowledge","知识点阅读"],["diagrams","图解浏览"]] as const).map(([id,label])=><button key={id} aria-pressed={mode===id} onClick={()=>choose(id)}>{label}</button>)}</nav><div hidden={mode!=="choice"}><PracticeView active={active&&mode==="choice"}/></div>{subjectiveVisited&&<div hidden={mode!=="subjective"}><ViewErrorBoundary><SubjectivePractice active={active&&mode==="subjective"}/></ViewErrorBoundary></div>}{mode==="review"&&<ViewErrorBoundary><ReviewQueue active={active&&mode==="review"}/></ViewErrorBoundary>}{(mode==="knowledge"||mode==="diagrams")&&<ViewErrorBoundary><StudyLibrary key={mode} mode={mode} active={active}/></ViewErrorBoundary>}</div>;
}
