import { API_BASE } from "./api";
import type { Question } from "./types";
export async function studyRequest<T>(path:string,body?:unknown,method="POST"):Promise<T>{
  const response=await fetch(API_BASE+path,body===undefined?undefined:{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({detail:"服务器没有返回有效数据。"}));
  if(!response.ok)throw new Error(typeof data.detail==="string"?data.detail:`请求失败 (${response.status})`);
  return data as T;
}
export type Verdict="correct"|"partial"|"incorrect";
export type GradeSuggestion={verdict:Verdict|"needs_review";confidence:string;score:number|null;feedback:string;strengths:string[];omissions:string[];next_steps:string[];points:Array<{id:string;awarded:number;evidence:string;reason:string}>;prompt_version:string;model:string};
export type SubjectiveAnswer={question:Question;answer:string;revision:number;submitted_at:string|null;independent:number;verdict:Verdict|null;score:number|null;grading_method:string|null;feedback:string;updated_at:string;point_scores:number[];rubric:Array<{id:string;label:string;max_score:number}>;events:Array<{id:string;kind:string;created_at:string;payload:GradeSuggestion}>};
export type SubjectiveSession={id:string;subject:string;mode:string;created_at:string;items:SubjectiveAnswer[]};
