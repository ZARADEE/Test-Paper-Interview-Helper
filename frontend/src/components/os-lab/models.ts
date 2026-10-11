import {integer,matrix,numbers,metric,type Inputs,type Result,type Step,type Cell} from './engine';
function commands(raw:string):string[][]{const rows=raw.trim().split(/\n|;/).filter(x=>x.trim()).map(x=>x.trim().split(/\s+/));if(!rows.length||rows.length>128)throw Error('请输入 1–128 行操作');return rows;}
export function sync(id:string,input:Inputs):Result{
 const steps:Step[]=[],ops=commands(input.actions);let rejected=0;
 if(id==='producer'){
  const cap=integer(input.capacity,'缓冲容量',1,32),buf:string[]=[];
  ops.forEach(([op,value],i)=>{let note='';if(op==='produce'){if(buf.length===cap){note='缓冲区满：生产者阻塞，本步没有写入';rejected++;}else{buf.push(value||String(i));note='P(empty) → P(mutex) → 放入 → V(mutex) → V(full)';}}else if(op==='consume'){if(!buf.length){note='缓冲区空：消费者阻塞，本步没有读取';rejected++;}else note='取出 '+buf.shift()+'；P(full) → P(mutex) → 取出 → V(mutex) → V(empty)';}else throw Error('操作仅支持 produce 值 / consume');steps.push({title:(i+1)+'. '+op,detail:note+'。本实验使用可重试操作序列，阻塞操作不自动重放。',columns:['empty','full','mutex（操作完成）'],rows:[[cap-buf.length,buf.length,1]],cells:Array.from({length:cap},(_,i)=>({label:'槽 '+i,value:buf[i]??'空'}))});});
 }else if(id==='readers'){
  const readers=new Set<string>();let writer='';ops.forEach(([op,p='0'],i)=>{let note='';if(op==='read'){if(writer||readers.has(p)){note='阻塞或重复读者';rejected++;}else{readers.add(p);note='读者进入；首个读者取得写锁';}}else if(op==='read_end'){if(!readers.delete(p))throw Error('读者尚未进入：'+p);note='读者离开；最后一个读者释放写锁';}else if(op==='write'){if(writer||readers.size){note='写者等待独占资源';rejected++;}else{writer=p;note='写者取得独占访问';}}else if(op==='write_end'){if(writer!==p)throw Error('写者未持有锁：'+p);writer='';note='写者释放资源';}else throw Error('支持 read/read_end/write/write_end 进程号');steps.push({title:(i+1)+'. '+op+' '+p,detail:note+'。采用读者优先；持续到达的读者可能使写者饥饿。阻塞请求需重试。',columns:['活动读者','写者','写锁'],rows:[[Array.from(readers).join('、')||'无',writer||'无',writer||readers.size?'占用':'空闲']]});});
 }else if(id==='philosophers'){
  const n=integer(input.capacity,'哲学家数',2,12),forks=Array(n).fill(-1) as number[],eating=new Set<number>();
  ops.forEach(([op,p],i)=>{const k=integer(p||'','哲学家',0,n-1),right=(k+1)%n;let note='';if(op==='take'){if(!eating.has(k)&&(forks[k]===-1||forks[k]===k)&&(forks[right]===-1||forks[right]===k)){forks[k]=k;forks[right]=k;eating.add(k);note='取得两把叉（保留自己已持有的叉），开始进餐';}else{note=eating.has(k)?'已经进餐，本步不重复获取':'两把叉无法同时取得，保持等待';rejected++;}}else if(op==='left'){if(forks[k]===-1){forks[k]=k;note='只拿左叉：用于构造循环等待';}else{note='左叉被占用';rejected++;}}else if(op==='release'){for(let f=0;f<n;f++)if(forks[f]===k)forks[f]=-1;eating.delete(k);note='放下持有的叉';}else throw Error('支持 take/left/release 哲学家号');const dead=forks.every((owner,f)=>owner===f)&&eating.size===0;steps.push({title:(i+1)+'. '+op+' P'+k,detail:note+(dead?'。所有人各持左叉，循环等待：死锁。':'。take 使用两叉原子获取，left 用于观察错误策略。'),columns:['哲学家','左叉持有人','右叉持有人','状态'],rows:forks.map((_,j)=>['P'+j,forks[j],forks[(j+1)%n],eating.has(j)?'进餐':dead?'死锁':'思考/等待']),cells:forks.map((owner,j)=>({label:'叉 '+j,value:owner<0?'空闲':'P'+owner}))});});
 }else{
  let table:string[]=[];let smoked=0;ops.forEach(([op,a,b],i)=>{let note='';const names=['tobacco','paper','match'];if(op==='supply'){if(table.length){note='桌面尚未清空，供应者等待';rejected++;}else{if(!names.includes(a)||!names.includes(b)||a===b)throw Error('supply 输入两种不同材料 tobacco/paper/match');table=[a,b];note='供应两种材料，唤醒拥有第三种材料的吸烟者';}}else if(op==='smoke'){if(!names.includes(a))throw Error('smoke 后填写持有材料');if(table.length===2&&!table.includes(a)){table=[];smoked++;note='材料齐全，吸烟完成并唤醒供应者';}else{note='材料不足，保持等待';rejected++;}}else throw Error('支持 supply 材料 材料 / smoke 持有材料');steps.push({title:(i+1)+'. '+op,detail:note,columns:['桌面材料','完成次数'],rows:[[table.join(' + ')||'空',smoked]]});});
 }
 return {steps,metrics:[metric('操作数',ops.length),metric('阻塞/未执行',rejected)]};
}

export function systemCalls(_id:string,input:Inputs):Result{
 const procs=[{pid:1,parent:0,image:'main',state:'运行',code:0}];const steps:Step[]=[];
 commands(input.actions).forEach(([op,id,arg],i)=>{const pid=integer(id||'','PID',1,100),p=procs.find(p=>p.pid===pid);if(!p)throw Error('不存在 PID '+pid);let note='';
  if(op==='wait'){if(p.state!=='运行')throw Error('当前进程无法调用 wait');const children=procs.filter(x=>x.parent===pid&&x.state!=='已回收'),child=children.find(x=>x.state==='僵尸');if(child){child.state='已回收';note='wait 回收子进程 '+child.pid+'，退出码 '+child.code;}else if(children.length){p.state='等待子进程';note='子进程尚未退出，父进程阻塞';}else note='无可等待子进程，返回错误';}
  else{if(p.state!=='运行')throw Error('PID '+pid+' 不在运行态');if(op==='fork'){if(procs.length>=32)throw Error('最多 32 个进程');const child={pid:procs.length+1,parent:pid,image:p.image,state:'运行',code:0};procs.push(child);note='父进程返回 '+child.pid+'，子进程返回 0；子进程继承程序映像。';}else if(op==='exec'){if(!arg)throw Error('exec 需要程序名');p.image=arg;note='替换程序映像，PID 保持 '+pid;}else if(op==='exit'){if(pid===1)throw Error('PID 1 是本模型的常驻回收进程，不支持退出；请 fork 子进程后演示 exit');p.code=integer(arg||'0','退出码',0,255);p.state='僵尸';const parent=procs.find(x=>x.pid===p.parent);if(parent?.state==='等待子进程'){parent.state='运行';p.state='已回收';}for(const c of procs)if(c.parent===pid&&c.state!=='已回收')c.parent=1;const init=procs[0],orphan=procs.find(c=>c.parent===1&&c.state==='僵尸');if(init.state==='等待子进程'&&orphan){init.state='运行';orphan.state='已回收';}note='退出并通知父进程；阻塞的 wait 可回收退出状态。孤儿进程交给 PID 1。';}else throw Error('支持 fork PID / exec PID 程序 / wait PID / exit PID 状态');}
  steps.push({title:(i+1)+'. '+op+' '+pid,detail:note+' 此为进程生命周期教学模型，不运行操作系统命令。',columns:['PID','PPID','映像','状态','退出码'],rows:procs.map(x=>[x.pid,x.parent,x.image,x.state,x.code])});
 });return {steps,metrics:[metric('创建进程',procs.length),metric('僵尸进程',procs.filter(x=>x.state==='僵尸').length)]};
}

export function files(id:string,input:Inputs):Result{
 const n=integer(input.diskSize,'磁盘块数',4,128),busy=input.occupied.trim()?numbers(input.occupied,'已占用块',0,n-1):[];
 const blocks=Array(n).fill('空闲') as string[],files=new Map<string,number[]>(),steps:Step[]=[];busy.forEach(b=>blocks[b]='系统占用');
 commands(input.actions).forEach(([op,name,arg],i)=>{if(!name||name.length>40)throw Error('需要文件名，最多 40 字符');let detail='';
  if(op==='delete'){const list=files.get(name);if(!list)throw Error('文件不存在');list.forEach(b=>blocks[b]='空闲');files.delete(name);detail='释放文件数据和索引块';}
  else if(op==='create'){
   if(files.has(name))throw Error('文件名重复');const count=integer(arg||'','数据块数量',1,n),free=blocks.flatMap((x,i)=>x==='空闲'?[i]:[]);let allocation:number[]=[];
   const overhead=id==='indexed'?1:id==='inode'?(count>4?2:1):0;
   if(id==='contiguous'){for(let b=0;b<=n-count;b++)if(blocks.slice(b,b+count).every(x=>x==='空闲')){allocation=Array.from({length:count},(_,j)=>b+j);break;}}
   else if(free.length>=count+overhead)allocation=free.slice(0,count+overhead);
   if(!allocation.length)detail='空间不足或没有连续区间，本次分配失败，磁盘不变';
   else{files.set(name,allocation);allocation.forEach((b,j)=>blocks[b]=name+(j<overhead?(id==='inode'&&j===0?' inode':' 索引'):' 数据'));const data=allocation.slice(overhead);detail=id==='linked'?'链指针：'+data.join(' → ')+' → EOF':id==='indexed'?'索引块 '+allocation[0]+' → ['+data.join(',')+']':id==='inode'?'inode '+allocation[0]+'；直接指针 '+data.slice(0,4).join(',')+(count>4?'；间接块 '+allocation[1]+' → '+data.slice(4).join(','):''):'起始块 '+data[0]+'，长度 '+count;}
  }else throw Error('支持 create 文件名 数据块数量 / delete 文件名');
  steps.push({title:(i+1)+'. '+op+' '+name,detail,columns:['文件','占用块（含索引）'],rows:[...files].map(([name,list])=>[name,list.join(' → ')]),cells:blocks.map((value,b)=>({label:String(b),value,active:value.startsWith(name+' ')}))});
 });return {steps,metrics:[metric('文件数',files.size),metric('空闲块',blocks.filter(x=>x==='空闲').length),metric('占用块',blocks.filter(x=>x!=='空闲').length)]};
}

export function directory(_id:string,input:Inputs):Result{
 const entries=new Map<string,string>([['/','目录']]);let cwd='/';const steps:Step[]=[];
 commands(input.actions).forEach(([op,name],i)=>{let detail='';const target=name==='/'?'/':name==='..'?cwd.substring(0,cwd.lastIndexOf('/'))||'/':(cwd==='/'?'':cwd)+'/'+name;
  if(op==='ls'||op==='tree')detail=[...entries.keys()].filter(p=>op==='tree'||p!=='/'&&(p.substring(0,p.lastIndexOf('/'))||'/')===cwd).join('、')||'空目录';
  else if(op==='cd'){if(entries.get(target)!=='目录')throw Error('目录不存在：'+target);cwd=target;detail='当前目录 '+cwd;}
  else{if(!name||name==='.'||name==='..'||name.includes('/'))throw Error('名称不能为空，也不能含路径分隔符');if(op==='mkdir'||op==='create'){if(entries.has(target))throw Error('名称重复');entries.set(target,op==='mkdir'?'目录':'文件');detail='创建 '+target;}else if(op==='delete'){if(!entries.has(target))throw Error('条目不存在');if([...entries.keys()].some(p=>p.startsWith(target+'/')))throw Error('目录非空，需先删除子项');entries.delete(target);detail='删除 '+target;}else if(op==='find')detail=entries.has(target)?'找到 '+target:'未找到 '+target;else throw Error('支持 mkdir / cd / create / delete / find / ls / tree');}
  steps.push({title:(i+1)+'. '+op+' '+(name||''),detail,columns:['路径','类型','当前位置'],rows:[...entries].map(([path,type])=>[path,type,path===cwd?'当前目录':''])});
 });return {steps,metrics:[metric('条目数',entries.size-1),metric('当前目录',cwd)]};
}

export function address(id:string,input:Inputs):Result{
 const steps:Step[]=[];
 if(id==='compaction'){
  const segments=numbers(input.segments,'分段布局（负数为空闲）',-10000,10000);if(segments.some(x=>x===0))throw Error('块大小不能为 0');let offset=0;const initial=segments.map((n,i)=>{const start=offset;offset+=Math.abs(n);return [i,start,Math.abs(n),n<0?'空闲':'已分配'];});
  steps.push({title:'紧凑前',detail:'正数表示占用段，负数表示空洞；模型假定所有进程可重定位。',columns:['段','基址','长度','类型'],rows:initial});let at=0;const moved:Cell[][]=[];segments.forEach((n,i)=>{if(n>0){moved.push([i,at,n,'已分配']);at+=n;steps.push({title:'移动段 '+i,detail:'保持占用段顺序，更新基址，合并尾部空洞。',columns:['段','新基址','长度','类型'],rows:moved.map(r=>[...r])});}});moved.push(['空闲',at,offset-at,'合并空洞']);steps.push({title:'紧凑完成',detail:'紧凑消除外部碎片，不增加内存总量。',columns:['段','基址','长度','类型'],rows:moved});return {steps,metrics:[metric('总内存',offset),metric('合并空洞',offset-at),metric('占用',at)]};
 }
 if(id==='segmentation'){
  const table=matrix(input.table,'段表'),requests=matrix(input.addresses,'逻辑地址');if(table.some(r=>r.length!==2)||requests.some(r=>r.length!==2))throw Error('段表为 基址 长度；地址为 段号 偏移');let faults=0;
  requests.forEach(([s,o],i)=>{const row=table[s],valid=row&&o<row[1];if(!valid)faults++;steps.push({title:'访问 '+i+'：('+s+','+o+')',detail:valid?'偏移 < 段长，物理地址 = 段基址 + 偏移':'段号不存在或偏移越界，产生段错误',columns:['段号','偏移','基址','段长','物理地址'],rows:[[s,o,row?.[0]??'无',row?.[1]??'无',valid?row[0]+o:'段错误']]});});return {steps,metrics:[metric('地址数',requests.length),metric('段错误',faults)]};
 }
 const size=integer(input.pageSize,'页大小',1,65536),table=numbers(input.table,'页表（-1 未驻留）',-1,10000),access=numbers(input.addresses,'虚拟地址',0,1000000),capacity=integer(input.capacity||'2','TLB 容量',1,32);let faults=0,hits=0;const tlb:number[]=[];
 for(const a of access){const p=Math.floor(a/size),o=a%size,frame=table[p],hit=id==='tlb'&&tlb.includes(p);let detail='';if(frame===undefined)detail='地址超出页表范围：非法地址';else if(frame<0){faults++;detail='有效页未驻留：缺页中断；本模型不自动指定新物理帧，请修改页表后重试';}else{if(hit){hits++;tlb.splice(tlb.indexOf(p),1);detail='TLB 命中';}else detail=id==='tlb'?'TLB 未命中，读取页表后填充':'读取页表得到帧号';if(id==='tlb'){tlb.push(p);if(tlb.length>capacity)tlb.shift();}}
  steps.push({title:'虚拟地址 '+a,detail:detail+'。页号 = 地址 / 页大小的商；偏移 = 余数。',columns:['页号','偏移','帧号','物理地址'],rows:[[p,o,frame??'无',frame!==undefined&&frame>=0?frame*size+o:'不可访问']],cells:id==='tlb'?tlb.map(p=>({label:'页 '+p,value:'帧 '+table[p],active:p===Math.floor(a/size)})):undefined});
 }return {steps,metrics:[metric('访问次数',access.length),metric('缺页中断',faults),...(id==='tlb'?[metric('TLB 命中',hits),metric('TLB 命中率',Math.round(hits/access.length*100)+'%')]:[])]};
}
