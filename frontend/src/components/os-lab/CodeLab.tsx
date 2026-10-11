import {useEffect,useRef,useState} from 'react';
import type {CppReply,CppRequest} from './cpp.worker';
import type {Sample} from './samples';
export function CodeLab({sample,experimentId,active}:{sample:Sample;experimentId:string;active:boolean}):JSX.Element {
 const draftKey='os-lab-cpp-v1:'+experimentId;
 const [code,setCode]=useState(()=>{try{return localStorage.getItem(draftKey)??sample.code;}catch{return sample.code;}}),[input,setInput]=useState(sample.input);
 const [reply,setReply]=useState<CppReply>(),[busy,setBusy]=useState(false),[message,setMessage]=useState('就绪'),[confirmReset,setConfirmReset]=useState(false),[saved,setSaved]=useState(false),[loadedInput,setLoadedInput]=useState(sample.input);
 const worker=useRef<Worker>(),timer=useRef<ReturnType<typeof setTimeout>>(),source=useRef<HTMLPreElement>(null);
 const modified=code!==sample.code;
 function stop(reason?:string):void{if(timer.current)clearTimeout(timer.current);worker.current?.terminate();worker.current=undefined;setBusy(false);if(reason){setMessage(reason);setReply(r=>r?.status==='paused'?{...r,status:'done',line:undefined}:r);}}
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);worker.current?.terminate();},[]);
 useEffect(()=>{if(!active)stop('已暂停：离开实验台');},[active]);
 useEffect(()=>{try{if(modified)localStorage.setItem(draftKey,code);else localStorage.removeItem(draftKey);setSaved(true);}catch{setSaved(false);}},[code,draftKey,modified]);
 useEffect(()=>{source.current?.querySelector('[aria-current="step"]')?.scrollIntoView({block:'nearest',inline:'nearest'});},[reply?.line]);
 function send(type:CppRequest['type']):void {
  if(type!=='step'){
   stop();setReply(undefined);
   let w:Worker;
   try{w=new Worker(new URL('./cpp.worker.ts',import.meta.url),{type:'module'});}catch(error){setMessage('运行器加载失败');setReply({status:'error',output:'',error:error instanceof Error?error.message:String(error)});return;}
   worker.current=w;
   w.onmessage=(event:MessageEvent<CppReply>)=>{if(worker.current!==w)return;if(timer.current)clearTimeout(timer.current);setBusy(false);setReply(event.data);setMessage(event.data.status==='paused'?'调试暂停 · 下一行 '+event.data.line:event.data.status==='done'?'执行完成 · 退出码 '+event.data.exitCode:'代码解析 / 运行失败');if(event.data.status!=='paused'){w.terminate();worker.current=undefined;}};
   w.onerror=event=>{if(worker.current!==w)return;stop();setReply({status:'error',output:'',error:event.message||'运行器加载失败'});setMessage('运行器错误');};
  }
  if(!worker.current)return;
  setBusy(true);setMessage(type==='step'?'执行下一行…':'解析并执行 C/C++…');
  timer.current=setTimeout(()=>{stop('已停止：单次执行超过 4 秒');setReply(r=>({status:'error',output:r?.output||'',error:'运行超时。检查无限循环，或缩小输入规模。'}));},4000);
  worker.current.postMessage({type,code,input} satisfies CppRequest);
 }
 function reset():void{stop('已载入样例与标准输入');setCode(sample.code);setInput(sample.input);setLoadedInput(sample.input);setReply(undefined);setConfirmReset(false);}
 function changeCode(value:string):void{stop('代码已修改，请重新运行');setCode(value);setReply(undefined);setConfirmReset(false);}
 return <section className="os-code" aria-label="C/C++ 代码练习">
  <header className="os-section-heading"><div><span className="os-eyebrow">CODE / C & C++</span><h3>写一段，运行一次，看清每一步。</h3></div><span className="os-badge">离线教学解释器</span></header>
  <p className="os-muted">支持常用变量、数组、指针、函数、循环和 cin / cout。基于 JSCPP，属于 C/C++ 教学子集，不生成 exe；完整 STL、多文件、真实线程和系统调用不在此运行。每次操作限 4 秒。</p>
  <div className="os-code-title"><strong>{sample.title}</strong><button onClick={()=>modified?setConfirmReset(true):reset()}>载入样例 / 同步输入</button></div>
  {loadedInput!==sample.input&&<p className="os-notice" data-testid="cpp-input-stale">上方实验参数已更新。代码区保留原来的标准输入，点击「载入样例 / 同步输入」后再核对结果。</p>}
  {confirmReset&&<div className="os-notice">载入会覆盖当前草稿。<button onClick={reset}>确认载入</button><button onClick={()=>setConfirmReset(false)}>保留草稿</button></div>}
  <div className="os-code-layout"><div><label className="os-field" htmlFor="os-cpp-code">C/C++ 源代码 <small>{modified?(saved?'已保存本机草稿':'草稿未保存，请复制备份'):'内置样例'}</small></label><textarea id="os-cpp-code" className="os-editor" spellCheck={false} value={code} maxLength={32768} onChange={e=>changeCode(e.target.value)} onKeyDown={e=>{if(e.key==='Tab'&&!e.shiftKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();const at=e.currentTarget.selectionStart,end=e.currentTarget.selectionEnd;if(code.length-(end-at)+4>32768)return;changeCode(code.slice(0,at)+'    '+code.slice(end));requestAnimationFrame(()=>{const el=document.getElementById('os-cpp-code') as HTMLTextAreaElement|null;el?.setSelectionRange(at+4,at+4);});}}}/>
   <label className="os-field" htmlFor="os-cpp-input">标准输入 stdin</label><textarea id="os-cpp-input" value={input} maxLength={8192} rows={5} spellCheck={false} onChange={e=>{stop('输入已修改，请重新运行');setInput(e.target.value);setReply(undefined);}}/>
   <div className="os-actions"><button className="os-primary" disabled={busy} onClick={()=>send('run')}>运行代码</button><button disabled={busy} onClick={()=>send('debug')}>开始逐行调试</button><button disabled={busy||reply?.status!=='paused'||!worker.current} onClick={()=>send('step')}>执行下一行</button><button disabled={!busy&&reply?.status!=='paused'} onClick={()=>stop('已手动停止')}>停止执行</button></div>
   <p role="status" className="os-run-status">{message}</p>
   <label className="os-field">标准输出 stdout</label><pre className="os-output" data-testid="cpp-output">{reply?.output||'（暂无输出）'}</pre>{reply?.error&&<pre role="alert" className="os-error">{reply.error}</pre>}
  </div><div className="os-code-analysis">
   <h4>关键代码解析</h4><p className="os-muted">{modified?'以下说明仅针对内置样例；你修改后的语义请结合实际调试变量判断。':'说明对应当前内置样例；调试行号和变量来自实际执行。'}</p>
   {sample.notes.map(n=><article key={n.marker}><span className="os-badge">样例第 {sample.code.split('\n').findIndex(l=>l.includes(n.marker))+1} 行</span><h4>{n.title}</h4><p>{n.text}</p></article>)}
   {reply?.status==='paused'&&<div className="os-debug"><h4>下一条语句 · 第 {reply.line} 行</h4><pre ref={source} className="os-debug-source">{code.split('\n').map((line,i)=><span key={i} aria-current={i+1===reply.line?'step':undefined}>{String(i+1).padStart(3,' ')} {line}{'\n'}</span>)}</pre><h4>当前作用域变量</h4><div className="os-table-scroll"><table><thead><tr><th>变量</th><th>类型</th><th>值</th></tr></thead><tbody>{reply.variables?.map(v=><tr key={v.name}><td>{v.name}</td><td>{v.type}</td><td>{v.value}</td></tr>)}</tbody></table></div>{!reply.variables?.length&&<p>当前尚无可见变量，继续单步进入 main。</p>}</div>}
  </div></div>
 </section>;
}
