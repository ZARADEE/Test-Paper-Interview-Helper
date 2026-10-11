export type Inputs = Record<string, string>;
export type Cell = string | number;
export type Step = { title: string; detail: string; columns: string[]; rows: Cell[][]; cells?: {label:string;value:string;active?:boolean}[] };
export type Result = { steps: Step[]; metrics: {label:string;value:Cell}[]; timeline?: {label:string;start:number;end:number}[]; route?:number[] };
export function numbers(raw:string,name:string,min=0,max=10000):number[]{
  const parts=raw.trim().split(/[\s,，]+/).filter(Boolean);
  if(!parts.length||parts.length>128)throw Error(name+'需要 1–128 个整数');
  return parts.map(s=>{const n=Number(s);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(name+'必须是 '+min+'–'+max+' 的整数');return n;});
}
export function integer(raw:string,name:string,min=0,max=10000):number{const n=numbers(raw,name,min,max);if(n.length!==1)throw Error(name+'只接受一个整数');return n[0];}
export function matrix(raw:string,name:string,min=0,max=10000):number[][]{const rows=raw.trim().split(/\n|;/).filter(s=>s.trim()).map(s=>numbers(s,name,min,max));if(!rows.length||rows.length>32||rows.some(r=>r.length!==rows[0].length))throw Error(name+'需为等宽矩阵，最多 32 行');return rows;}
export const metric=(label:string,value:Cell)=>({label,value});
const fmt=(n:number)=>Number(n.toFixed(3));

export function cpu(id:string,input:Inputs):Result {
  const raw=matrix(input.processes,'进程（到达、执行、优先级）');
  if(raw.some(r=>r.length!==3||r[1]<1)||raw.length>20)throw Error('最多 20 个进程，每行：到达时间 执行时间 优先级，执行时间必须大于 0');
  if(raw.reduce((s,r)=>s+r[1],0)+Math.max(...raw.map(r=>r[0]))>2000)throw Error('到达时间与总执行时间合计最多 2000');
  const q=integer(input.quantum,'时间片',1,100),p=raw.map((r,i)=>({id:i,a:r[0],b:r[1],priority:r[2],left:r[1],first:-1,end:0}));
  const timeline:NonNullable<Result['timeline']>=[],steps:Step[]=[],queue:number[]=[];let time=0,done=0,current=-1,spent=0;const admitted=new Set<number>();
  while(done<p.length){
    for(const x of [...p].sort((a,b)=>a.a-b.a||a.id-b.id))if(x.a<=time&&!admitted.has(x.id)){queue.push(x.id);admitted.add(x.id);}
    if(id==='rr'&&current>=0&&spent>=q){queue.push(current);current=-1;spent=0;}
    const ready=p.filter(x=>x.a<=time&&x.left>0);
    if(!ready.length){const next=Math.min(...p.filter(x=>x.left>0).map(x=>x.a));timeline.push({label:'空闲',start:time,end:next});time=next;continue;}
    if(id==='rr'){if(current<0){current=queue.shift()!;spent=0;}}
    else if(current<0||id==='srtf'||id==='priority-p'){
      ready.sort((a,b)=>id==='fcfs'?a.a-b.a||a.id-b.id:id==='sjf'?a.b-b.b||a.a-b.a||a.id-b.id:id==='srtf'?a.left-b.left||a.a-b.a||a.id-b.id:a.priority-b.priority||a.a-b.a||a.id-b.id);current=ready[0].id;
    }
    const x=p[current];if(x.first<0)x.first=time;
    const last=timeline[timeline.length-1];if(last?.label==='P'+x.id&&last.end===time)last.end=time+1;else timeline.push({label:'P'+x.id,start:time,end:time+1});
    x.left--;time++;spent++;if(x.left===0){x.end=time;done++;current=-1;spent=0;}
    steps.push({title:'t='+time+' · P'+x.id+' 执行一个时间单位',detail:'就绪：'+(p.filter(v=>v.a<=time&&v.left>0).map(v=>'P'+v.id).join('、')||'无')+'。优先级数值越小越优先；同等条件按到达时间、进程号排序。',columns:['进程','到达','执行','剩余','首次运行','完成'],rows:p.map(v=>['P'+v.id,v.a,v.b,v.left,v.first<0?'—':v.first,v.end||'—'])});
  }
  steps.push({title:'调度完成',detail:'周转 = 完成 − 到达；等待 = 周转 − 执行；响应 = 首次运行 − 到达。',columns:['进程','完成','周转','等待','响应'],rows:p.map(x=>['P'+x.id,x.end,x.end-x.a,x.end-x.a-x.b,x.first-x.a])});
  const idle=timeline.filter(t=>t.label==='空闲').reduce((s,t)=>s+t.end-t.start,0);
  return {steps,timeline,metrics:[metric('平均等待',fmt(p.reduce((s,x)=>s+x.end-x.a-x.b,0)/p.length)),metric('平均周转',fmt(p.reduce((s,x)=>s+x.end-x.a,0)/p.length)),metric('平均响应',fmt(p.reduce((s,x)=>s+x.first-x.a,0)/p.length)),metric('完成时刻',time),metric('空闲时间',idle),metric('吞吐量 / 单位时间',fmt(p.length/time)),metric('上下文切换（含空闲）',Math.max(0,timeline.length-1)),metric('CPU 利用率',fmt((time-idle)/time*100)+'%')]};
}

export function pages(id:string,input:Inputs):Result{
  const refs=numbers(input.refs,'访问序列',0,999),count=integer(input.frames,'物理帧数',1,16),frames:number[]=[],loaded:number[]=[],last:number[]=[],freq:number[]=[],bits:number[]=[];
  let faults=0,hand=0,seed=integer(input.seed||'408','随机种子',0,2147483647);const steps:Step[]=[];
  refs.forEach((page,t)=>{let slot=frames.indexOf(page),note='命中';const hit=slot>=0;
    if(!hit){faults++;if(frames.length<count)slot=frames.length;else{
      if(id==='second-chance'){while(bits[hand]===1){bits[hand]=0;hand=(hand+1)%count;}slot=hand;hand=(hand+1)%count;}
      else if(id==='random-page'){seed=(Math.imul(seed,1664525)+1013904223)>>>0;slot=seed%count;}
      else{slot=0;for(let j=1;j<count;j++){
        const next=(v:number)=>{const n=refs.indexOf(v,t+1);return n<0?Infinity:n;};
        if(id==='fifo'&&loaded[j]<loaded[slot]||id==='lru'&&last[j]<last[slot]||id==='mru'&&last[j]>last[slot]||id==='lfu'&&(freq[j]<freq[slot]||freq[j]===freq[slot]&&loaded[j]<loaded[slot])||id==='opt'&&next(frames[j])>next(frames[slot]))slot=j;
      }}note='缺页，淘汰 '+frames[slot];
    }if(frames[slot]===undefined)note='缺页，装入空闲帧';frames[slot]=page;loaded[slot]=t;freq[slot]=0;}
    last[slot]=t;freq[slot]++;bits[slot]=1;
    steps.push({title:'访问 '+(t+1)+'：页 '+page+' · '+note,detail:'累计缺页 '+faults+'，命中 '+(t+1-faults)+'。LFU 统计驻留期间频次，同频时淘汰最早装入页。',columns:['物理帧','页号','最近访问序号','驻留访问次数','引用位'],rows:Array.from({length:count},(_,i)=>[i,frames[i]??'空闲',last[i]===undefined?'—':last[i]+1,freq[i]??0,bits[i]??0]),cells:Array.from({length:count},(_,i)=>({label:'帧 '+i,value:String(frames[i]??'空'),active:i===slot}))});
  });return {steps,metrics:[metric('缺页次数',faults),metric('命中次数',refs.length-faults),metric('缺页率',fmt(faults/refs.length*100)+'%'),metric('命中率',fmt((refs.length-faults)/refs.length*100)+'%')]};
}

export function disk(id:string,input:Inputs):Result{
  const max=integer(input.max,'最大柱面',1,9999),head=integer(input.head,'起始柱面',0,max),requests=numbers(input.requests,'请求柱面',0,max);let route:number[]=[];
  if(id==='disk-fcfs')route=[...requests];
  else if(id==='lifo')route=[...requests].reverse();
  else if(id==='rss'){route=[...requests];let seed=integer(input.seed||'408','随机种子',0,2147483647);for(let j=route.length-1;j>0;j--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const k=seed%(j+1);[route[j],route[k]]=[route[k],route[j]];}}
  else if(id==='sstf'){const pending=[...requests];let at=head;while(pending.length){let ix=0;for(let i=1;i<pending.length;i++)if(Math.abs(pending[i]-at)<Math.abs(pending[ix]-at))ix=i;at=pending.splice(ix,1)[0];route.push(at);}}
  else{const same=requests.filter(x=>x===head),up=requests.filter(x=>x>head).sort((a,b)=>a-b),down=requests.filter(x=>x<head).sort((a,b)=>b-a),left=input.direction==='down';
   if(id==='look')route=left?[...same,...down,...up]:[...same,...up,...down];
   else if(id==='clook')route=left?[...same,...down,...up.reverse()]:[...same,...up,...down.reverse()];
   else if(id==='cscan')route=left?[...same,...down,...(up.length?[0,max,...up.reverse()]:[])]:[...same,...up,...(down.length?[max,0,...down.reverse()]:[])];
   else route=left?[...same,...down,...(up.length?[0]:[]),...up]:[...same,...up,...(down.length?[max]:[]),...down];}
  let at=head,total=0;const rows:Cell[][]=[],steps:Step[]=[];
  for(const next of route){const movement=Math.abs(next-at);total+=movement;rows.push([at,next,movement,total]);steps.push({title:'磁头 '+at+' → '+next,detail:'SCAN 在反向服务前先到物理边界；最后一个请求完成即停止。移动量按柱面数计，不是毫秒。',columns:['起点','终点','移动柱面','累计'],rows:rows.map(r=>[...r]),cells:[{label:'磁头',value:String(next),active:true},{label:'累计移动',value:String(total)}]});at=next;}
  return {steps,route:[head,...route],metrics:[metric('总移动量',total),metric('每请求平均移动',fmt(total/requests.length)),metric('服务路线',[head,...route].join(' → '))]};
}

export function memory(id:string,input:Inputs):Result{
  const blocks=numbers(input.blocks,'分区/空闲块',1,10000),jobs=numbers(input.jobs,'进程大小',1,10000);if(blocks.length>24||jobs.length>32)throw Error('最多 24 个分区和 32 个进程');
  const fixed=id==='mft',remaining=[...blocks],used=blocks.map(()=>false),assigned:Cell[][]=[],steps:Step[]=[];let cursor=0,internal=0,ok=0;
  for(let j=0;j<jobs.length;j++){let candidates=remaining.map((size,i)=>({size,i})).filter(x=>x.size>=jobs[j]&&(!fixed||!used[x.i]));
    if(id==='best-fit')candidates.sort((a,b)=>a.size-b.size||a.i-b.i);
    if(id==='worst-fit')candidates.sort((a,b)=>b.size-a.size||a.i-b.i);
    if(id==='next-fit')candidates.sort((a,b)=>(a.i-cursor+blocks.length)%blocks.length-(b.i-cursor+blocks.length)%blocks.length);
    const pick=candidates[0];let detail='没有足够大的空闲块，进程等待。';
    if(pick){ok++;used[pick.i]=true;if(fixed){internal+=remaining[pick.i]-jobs[j];remaining[pick.i]=0;}else remaining[pick.i]-=jobs[j];cursor=remaining[pick.i]>0?pick.i:(pick.i+1)%blocks.length;detail='P'+j+' 分配到块 '+pick.i+'。'+(fixed?'固定分区剩余为内部碎片，不能再分配。':'可变分区剩余保持为空闲块。');}
    assigned.push(['P'+j,jobs[j],pick?pick.i:'等待']);steps.push({title:'申请 '+jobs[j]+' 单位',detail,columns:['进程','大小','分配块'],rows:assigned.map(r=>[...r]),cells:remaining.map((v,i)=>({label:'块 '+i+' / 原 '+blocks[i],value:fixed&&used[i]?'已占用':'空闲 '+v,active:i===pick?.i}))});
  }
  const free=remaining.reduce((s,n)=>s+n,0);return {steps,metrics:[metric('成功分配',ok+'/'+jobs.length),metric('可用内存',free),metric('内部碎片',internal),metric('最大空闲块',Math.max(...remaining)),metric('已分配利用率',fmt((blocks.reduce((s,n)=>s+n,0)-free-internal)/blocks.reduce((s,n)=>s+n,0)*100)+'%')]};
}

export function banker(id:string,input:Inputs):Result{
  const alloc=matrix(input.allocation,'已分配'),other=matrix(input.demand,id==='banker'?'最大需求':'当前请求'),avail=numbers(input.available,'可用资源');
  if(alloc.length!==other.length||alloc.some(r=>r.length!==avail.length)||other.some(r=>r.length!==avail.length))throw Error('矩阵行数及资源列数必须一致');
  const need=other.map((r,i)=>r.map((n,j)=>id==='banker'?n-alloc[i][j]:n));if(need.some(r=>r.some(n=>n<0)))throw Error('最大需求不能小于已分配');
  const work=[...avail],done=alloc.map(r=>id==='detection'&&r.every(n=>n===0)),seq:number[]=[],steps:Step[]=[];
  const snap=(title:string,detail:string)=>steps.push({title,detail,columns:['进程','Allocation','Need / Request','状态'],rows:alloc.map((r,i)=>['P'+i,r.join(' '),need[i].join(' '),done[i]?'可完成':'待检查']),cells:work.map((n,i)=>({label:'Work R'+i,value:String(n)}))});
  snap('初始状态','银行家用 Max − Allocation 计算 Need；检测用当前 Request，零占用进程不属于死锁集合。');
  while(true){const i=alloc.findIndex((_,i)=>!done[i]&&need[i].every((n,j)=>n<=work[j]));if(i<0)break;done[i]=true;seq.push(i);alloc[i].forEach((n,j)=>work[j]+=n);snap('P'+i+' 可完成，释放资源','安全前缀：'+seq.map(n=>'P'+n).join(' → '));}
  const stuck=done.flatMap((v,i)=>v?[]:['P'+i]);snap(stuck.length?'无法继续':'全部可完成',stuck.length?(id==='banker'?'不安全状态不等于当前已经死锁。':'未完成且占有资源的进程构成检测到的死锁集合。'):'资源检查通过。');
  return {steps,metrics:[metric('状态',stuck.length?(id==='banker'?'不安全':'检测到死锁'):'安全 / 无死锁'),metric('可完成顺序',seq.map(n=>'P'+n).join(' → ')||'无'),metric('未完成进程',stuck.join('、')||'无')]};
}

export function bankerRequest(_id:string,input:Inputs):Result {
 const original=banker('banker',input),allocation=matrix(input.allocation,'已分配'),max=matrix(input.demand,'最大需求'),available=numbers(input.available,'可用资源');
 const pid=integer(input.pid,'申请进程',0,allocation.length-1),request=numbers(input.request,'请求向量');
 if(request.length!==available.length)throw Error('请求向量列数必须与资源数一致');
 const need=max[pid].map((v,j)=>v-allocation[pid][j]);
 const reject=(reason:string):Result=>({steps:[original.steps[0],{...original.steps[0],title:'请求未授予，保留原状态',detail:reason}],metrics:[metric('请求结果',reason),metric('Available',available.join(' '))]});
 if(request.some((n,j)=>n>need[j]))return reject('拒绝：超过声明的最大需求');
 if(request.some((n,j)=>n>available[j]))return reject('等待：可用资源不足');
 const trial=allocation.map(row=>[...row]),left=available.map((v,j)=>v-request[j]);request.forEach((v,j)=>trial[pid][j]+=v);
 const checked=banker('banker',{...input,allocation:trial.map(row=>row.join(' ')).join('\n'),available:left.join(' ')});
 const safe=checked.metrics[0].value==='安全 / 无死锁';
 const final=safe?{...checked.steps[0],title:'授予请求，提交试分配状态',detail:'安全性检查通过。此状态显示申请后的 Allocation / Need / Available，并非所有进程完成后的 Work。'}:{...original.steps[0],title:'回滚试分配，保留原状态',detail:'试分配后没有安全序列，进程等待；不永久扣减 Available。'};
 return {steps:[original.steps[0],{...checked.steps[0],title:'P'+pid+' 试申请 '+request.join(' '),detail:'先检查 Request ≤ Need 和 Request ≤ Available，再暂时分配并检查安全性。'},...checked.steps.slice(1),final],metrics:[metric('请求结果',safe?'授予':'等待：试分配不安全'),metric('安全序列',checked.metrics[1].value),metric('Available',(safe?left:available).join(' '))]};
}

export function pagingAllocation(_id:string,input:Inputs):Result {
 const total=integer(input.total,'总内存',1,1000000),size=integer(input.pageSize,'页大小',1,total),jobs=numbers(input.jobs,'进程大小',1,1000000),count=Math.floor(total/size);
 if(count>128||jobs.length>32)throw Error('教学展示最多 128 个物理帧、32 个进程');
 const frames=Array(count).fill('空闲') as string[],rows:Cell[][]=[],steps:Step[]=[];let used=0,internal=0,allocated=0;
 jobs.forEach((n,i)=>{const pages=Math.ceil(n/size),fits=pages<=count-used;
  if(fits){const first=used;for(let page=0;page<pages;page++)frames[used++]='P'+i+' 页 '+page;internal+=pages*size-n;allocated++;rows.push(['P'+i,n,pages,first+'–'+(used-1),pages*size-n]);}
  else rows.push(['P'+i,n,pages,'等待',0]);
  steps.push({title:'P'+i+' 申请 '+pages+' 帧',detail:fits?'进程页数 = 向上取整(进程大小 / 页大小)。最后一页未使用部分为内部碎片。':'空闲帧不足，整个进程等待；本模型不作部分装入，也不修改已有映射。',columns:['进程','字节数','页数','物理帧','内部碎片'],rows:rows.map(row=>[...row]),cells:frames.map((value,f)=>({label:'帧 '+f,value,active:value.startsWith('P'+i+' ')}))});
 });return {steps,metrics:[metric('已分配进程',allocated+'/'+jobs.length),metric('已用 / 总帧',used+'/'+count),metric('内部碎片',internal),metric('不足一帧的尾部空间',total-count*size),metric('空闲帧',count-used)]};
}
