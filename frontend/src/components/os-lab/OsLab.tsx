import {useEffect,useMemo,useState} from 'react';
import {EXPERIMENTS,defaults,type Experiment} from './catalog';
import {integer,type Inputs,type Result} from './engine';
import {sampleFor} from './samples';
import {CodeLab} from './CodeLab';
import './os-lab.css';
const groups=[...new Set(EXPERIMENTS.map(e=>e.group))];
type Session={input:Inputs;result:Result};
const initial=(e:Experiment):Session=>{const input=defaults(e);return {input,result:e.run(e.id,input)};};
export function OsLab({active}:{active:boolean}):JSX.Element {
 const [id,setId]=useState('fcfs'),[query,setQuery]=useState('');
 const e=EXPERIMENTS.find(e=>e.id===id)!;
 return <section className="os-lab" aria-label="408 操作系统实验台">
  <header className="os-hero"><div><span className="os-eyebrow">408 / OPERATING SYSTEMS</span><h2>把操作系统<br/>跑给自己看。</h2><p>改参数，追踪状态，再用 C/C++ 亲手验证。</p></div><div className="os-stamp"><strong>{EXPERIMENTS.length}</strong><span>实验 · {groups.length} 组主题</span></div></header>
  <div className="os-layout"><aside className="os-catalog"><label className="os-field" htmlFor="os-search">查找实验</label><input id="os-search" value={query} onChange={v=>setQuery(v.target.value)} placeholder="例如：LRU / 死锁 / 地址"/><nav aria-label="操作系统实验列表">{groups.map(group=>{const list=EXPERIMENTS.filter(e=>e.group===group&&(e.name+' '+group).toLowerCase().includes(query.toLowerCase().trim()));return list.length>0&&<div key={group}><h3>{group}</h3>{list.map(x=><button key={x.id} aria-pressed={id===x.id} onClick={()=>setId(x.id)}>{x.name}</button>)}</div>;})}{!EXPERIMENTS.some(e=>(e.name+' '+e.group).toLowerCase().includes(query.toLowerCase().trim()))&&<p>没有匹配的实验。</p>}</nav></aside>
   <div className="os-main"><ExperimentPanel key={id} experiment={e} active={active}/></div>
  </div>
  <footer className="os-footer">参照项目：<a href="https://github.com/himanshusinghpatel998/os_visualiser" target="_blank" rel="noreferrer">os_visualiser ↗</a> · <a href="https://github.com/felixhao28/JSCPP" target="_blank" rel="noreferrer">JSCPP ↗</a> · 独立实现的教学模型，算法约定见各实验说明。</footer>
 </section>;
}
function ExperimentPanel({experiment:e,active}:{experiment:Experiment;active:boolean}):JSX.Element {
 const [session,setSession]=useState(()=>initial(e)),[input,setInput]=useState(session.input),[error,setError]=useState(''),[index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(800);
 const [comparison,setComparison]=useState<{name:string;metrics:Result['metrics']}[]>([]);
 const result=session.result,step=result.steps[index];
 const dirty=JSON.stringify(input)!==JSON.stringify(session.input);
 const sample=useMemo(()=>sampleFor(e,session.input),[e,session.input]);
 useEffect(()=>{if(!playing||!active)return;if(index>=result.steps.length-1){setPlaying(false);return;}const timer=setTimeout(()=>setIndex(index+1),speed);return()=>clearTimeout(timer);},[playing,active,speed,result,index]);
 useEffect(()=>{setComparison([]);},[input]);
 function run(values=input):void{try{const result=e.run(e.id,values);setSession({input:{...values},result});setIndex(0);setPlaying(false);setComparison([]);setError('');}catch(ex){setError(ex instanceof Error?ex.message:String(ex));setPlaying(false);}}
 function reset():void{const values=defaults(e);setInput(values);run(values);}
 function compare():void{try{setComparison(EXPERIMENTS.filter(x=>x.group===e.group).map(x=>({name:x.name,metrics:x.run(x.id,input).metrics})));setError('');}catch(ex){setComparison([]);setError(ex instanceof Error?ex.message:String(ex));}}
 return <>
  <section className="os-experiment"><header className="os-section-heading"><div><span className="os-eyebrow">{e.group}</span><h3>{e.name}</h3></div><span className="os-badge">参数实验</span></header><p>{e.intro}</p>
   <form onSubmit={event=>{event.preventDefault();run();}}><div className="os-fields">{e.fields.map(f=><div key={f.key}><label className="os-field" htmlFor={'os-param-'+f.key}>{f.label}</label>{f.choices?<select id={'os-param-'+f.key} value={input[f.key]} onChange={v=>setInput({...input,[f.key]:v.target.value})}>{f.choices.map(([v,label])=><option key={v} value={v}>{label}</option>)}</select>:f.value.includes('\n')||f.key==='refs'||f.key==='requests'?<textarea id={'os-param-'+f.key} rows={f.value.includes('\n')?Math.min(6,f.value.split('\n').length):2} value={input[f.key]} maxLength={8192} spellCheck={false} onChange={v=>setInput({...input,[f.key]:v.target.value})}/>:<input id={'os-param-'+f.key} value={input[f.key]} maxLength={2048} onChange={v=>setInput({...input,[f.key]:v.target.value})}/>}<small>{f.help}</small></div>)}</div><div className="os-actions"><button type="submit" className="os-primary">运行实验</button><button type="button" onClick={reset}>恢复默认参数</button>{['CPU 调度','页面置换','磁盘调度','分区与连续分配'].includes(e.group)&&<button type="button" onClick={compare}>同参数对比算法</button>}</div></form>
   {error&&<p role="alert" className="os-error">{error}</p>}{dirty&&<p className="os-notice">参数已修改。下方保留上次运行结果，点击「运行实验」更新。</p>}
  </section>
  <section className="os-results" aria-label="模拟结果"><div className="os-section-heading"><h3>运行结果</h3><span className="os-badge">{result.steps.length} 个状态</span></div><div className="os-metrics">{result.metrics.map(m=><div key={m.label}><span>{m.label}</span><strong>{m.value}</strong></div>)}</div>
   {result.timeline&&<div className="os-timeline-wrap"><h4>CPU 甘特图 · 完整运行</h4><div className="os-timeline" aria-label="CPU 甘特图">{result.timeline.map((t,i)=><div key={i} className={t.label==='空闲'?'idle':''} style={{flexGrow:t.end-t.start}}><strong>{t.label}</strong><span>{t.start}–{t.end}</span></div>)}</div></div>}
   {result.timeline&&<CpuBars result={result}/>}
   {result.route&&<DiskRoute route={result.route} max={integer(session.input.max,'最大柱面',1,9999)}/>}
   <div className="os-player"><div className="os-actions"><button disabled={index===0} onClick={()=>{setIndex(0);setPlaying(false);}}>回到开始</button><button disabled={index===0} onClick={()=>{setIndex(i=>i-1);setPlaying(false);}}>上一步</button><button onClick={()=>{if(index===result.steps.length-1)setIndex(0);setPlaying(v=>!v);}}>{playing?'暂停回放':'自动回放'}</button><button disabled={index===result.steps.length-1} onClick={()=>{setIndex(i=>i+1);setPlaying(false);}}>下一步</button><button disabled={index===result.steps.length-1} onClick={()=>{setIndex(result.steps.length-1);setPlaying(false);}}>最后一步</button><label>速度 <select value={speed} aria-label="回放速度" onChange={v=>setSpeed(Number(v.target.value))}><option value={1600}>慢</option><option value={800}>正常</option><option value={250}>快</option></select></label></div><label className="os-scrubber">步骤 {index+1} / {result.steps.length}<input type="range" min={0} max={result.steps.length-1} value={index} aria-label="实验步骤" onChange={v=>{setIndex(Number(v.target.value));setPlaying(false);}}/></label></div>
   <div className="os-state" aria-live="polite"><h4>{step.title}</h4><p>{step.detail}</p>{step.cells&&<div className="os-cells">{step.cells.map((cell,i)=><div key={i} className={cell.active?'active':''}><span>{cell.label}</span><strong>{cell.value}</strong></div>)}</div>}<div className="os-table-scroll"><table><thead><tr>{step.columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{step.rows.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table></div></div>
  </section>
  {comparison.length>0&&<section className="os-comparison"><h3>同参数算法对比</h3><p className="os-muted">按点击对比时的参数计算；不同策略的假设见实验说明。</p><div className="os-table-scroll"><table><thead><tr><th>算法</th>{comparison[0].metrics.map(m=><th key={m.label}>{m.label}</th>)}</tr></thead><tbody>{comparison.map(row=><tr key={row.name}><th>{row.name}</th>{row.metrics.map(m=><td key={m.label}>{m.value}</td>)}</tr>)}</tbody></table></div></section>}
  <CodeLab key={e.id} sample={sample} experimentId={e.id} active={active}/>
 </>;
}
function CpuBars({result}:{result:Result}):JSX.Element {
 const rows=result.steps[result.steps.length-1].rows,max=Math.max(1,...rows.flatMap(row=>row.slice(2).map(Number)));
 return <details className="os-charts"><summary>展开进程等待 / 周转 / 响应对比图</summary><div>{rows.map(row=><div key={String(row[0])}><strong>{row[0]}</strong>{[[3,'等待'],[2,'周转'],[4,'响应']].map(([index,label])=><div className="os-bar-row" key={label}><span>{label}</span><div className="os-bar-track"><i style={{width:Number(row[Number(index)])/max*100+'%'}}/></div><b>{row[Number(index)]}</b></div>)}</div>)}</div></details>;
}
function DiskRoute({route,max}:{route:number[];max:number}):JSX.Element {
 const x=(v:number)=>30+v/max*480,y=(i:number)=>25+i/Math.max(1,route.length-1)*170;
 return <div className="os-disk-chart"><h4>磁头路线 · 横轴柱面 / 纵轴服务顺序</h4><svg viewBox="0 0 550 220" role="img" aria-label={'磁头路线 '+route.join(' → ')}><line x1="30" y1="15" x2="510" y2="15" stroke="currentColor"/><text x="25" y="12">0</text><text x="495" y="12">{max}</text><polyline fill="none" stroke="#126f79" strokeWidth="2" points={route.map((v,i)=>x(v)+','+y(i)).join(' ')}/>{route.map((v,i)=><g key={i}><circle cx={x(v)} cy={y(i)} r="3" fill="#182329"/>{route.length<=20&&<text x={x(v)+5} y={y(i)+4}>{v}</text>}</g>)}</svg></div>;
}
