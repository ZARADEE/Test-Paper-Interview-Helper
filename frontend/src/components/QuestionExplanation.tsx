import { useState } from "react";
import type { Question } from "../types";
import { API_BASE, questionPreviewUrl } from "../api";
import { RichText } from "./RichText";
import { VisualPlayer } from "./visuals/VisualPlayer";
import { AddReviewButton } from "./ReviewTask";

export function QuestionExplanation({question,selected=[],active=true,reviewItemId,reviewToken}:{question:Question;selected?:string[];active?:boolean;reviewItemId?:number;reviewToken?:string}):JSX.Element {
  const [tab,setTab]=useState<"text"|"options"|"visual">("text");
  const source=question.explanation_source;
  return <section className="question-explanation">{!reviewItemId&&<AddReviewButton sourceId={question.id}/>}<div className="study-tabs" aria-label="解析内容"><button aria-pressed={tab==="text"} onClick={()=>setTab("text")}>参考解析</button>{!!question.option_explanations?.length&&<button aria-pressed={tab==="options"} onClick={()=>setTab("options")}>逐选项详解</button>}{question.visual&&<button aria-pressed={tab==="visual"} onClick={()=>setTab("visual")}>过程图解</button>}</div>{tab==="text"&&<><RichText text={question.analysis_markdown||question.answer_markdown}/>{question.analysis_source_document_id&&<img loading="lazy" className="practice-question-image" src={reviewItemId?`${API_BASE}/reviews/items/${reviewItemId}/preview?kind=analysis&token=${encodeURIComponent(reviewToken??"")}`:questionPreviewUrl(question.id,"analysis")} alt="原版参考解析"/>}</>}{tab==="options"&&question.options.map((option,i)=><article className={selected.includes(option.key)?"option-explanation is-selected":"option-explanation"} key={option.key}><strong>{option.key} · {option.text}{selected.includes(option.key)?"（你的选择）":""}</strong><RichText text={question.option_explanations?.[i]}/></article>)}{tab==="visual"&&question.visual&&<VisualPlayer spec={question.visual} active={active}/>} {source&&<small className="explanation-source">来源：<a href={`${source.repository}/blob/${source.commit}/${source.path}`} target="_blank" rel="noreferrer">43aquarius/cs408 · 原始讲解</a></small>}</section>;
}
