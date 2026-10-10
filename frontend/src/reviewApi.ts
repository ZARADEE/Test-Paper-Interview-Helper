import { API_BASE } from "./api";
export type ReviewSummary={date:string;timezone:string;task_id:string;remaining:number;ready:number;upcoming:number;deferred:number;reviewed:number;ratings:number;new_used:number;review_used:number;completed:boolean;next_due:string|null;reminders_enabled:boolean;total:number};
export type ReviewItem={id:number;source_type:string;source_id:string;title:string;subject:string;reason:string;state:number;new:boolean;due_at:string;overdue:boolean;suspended:boolean;postponed_until:string|null;revision:number};
export type ReviewQueue={summary:ReviewSummary;items:ReviewItem[];ready_ids:number[];last_rating:{id:string;item_id:number}|null};
export type ReviewQuestion={item:ReviewItem;question:Record<string,unknown>};
export type ReviewPreview={rating:number;due_at:string;seconds:number};
export type ReviewReveal={question:Record<string,unknown>;previews:ReviewPreview[];token:string};
export type ReviewSettings={desired_retention:number;learning_steps:number[];relearning_steps:number[];maximum_interval:number;new_limit:number;review_limit:number;timezone:string;reminders_enabled:boolean;auto_add_wrong:boolean;parameters:number[];revision:number;scheduler_version:string;optimizer_samples:number;optimizer_minimum:number;optimization:Record<string,unknown>|null};
export async function reviewRequest<T>(path:string,options?:RequestInit):Promise<T>{const response=await fetch(`${API_BASE}${path}`,options);const data=await response.json().catch(()=>({detail:"复习服务没有返回有效数据。"}));if(!response.ok)throw new Error(typeof data.detail==="string"?data.detail:`复习请求失败 (${response.status})`);return data as T;}
export const reviewJson=<T,>(path:string,body:unknown,method="POST")=>reviewRequest<T>(path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
