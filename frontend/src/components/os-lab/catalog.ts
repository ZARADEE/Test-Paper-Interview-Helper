import {cpu,pages,disk,memory,banker,bankerRequest,pagingAllocation,type Inputs,type Result} from './engine';
import {sync,systemCalls,files,directory,address} from './models';
export type Field={key:string;label:string;value:string;help?:string;choices?:[string,string][]};
export type Experiment={id:string;name:string;group:string;intro:string;fields:Field[];run:(id:string,input:Inputs)=>Result;sample:string};
const field=(key:string,label:string,value:string,help?:string):Field=>({key,label,value,help});
const all:Experiment[]=[];
function add(group:string,entries:[string,string][],intro:string,fields:Field[],run:Experiment['run'],sample:string){entries.forEach(([id,name])=>all.push({id,name,group,intro,fields,run,sample}));}
add('CPU 调度',[['fcfs','FCFS 先来先服务'],['sjf','SJF 短作业优先'],['srtf','SRTF 最短剩余时间'],['rr','RR 时间片轮转'],['priority','非抢占优先级'],['priority-p','抢占优先级']],
 '修改到达时间和执行长度，观察抢占、就绪顺序与等待时间。时间单位自行约定，优先级越小越高。',
 [field('processes','进程矩阵','0 5 2\n1 3 1\n2 1 3','每行：到达时间 执行时间 优先级。P0 起编号。'),field('quantum','时间片（RR）','2')],cpu,'cpu');
add('页面置换',[['fifo','FIFO 先进先出'],['opt','OPT 最优置换'],['lru','LRU 最近最少使用'],['lfu','LFU 最不经常使用'],['mru','MRU 最近使用淘汰'],['random-page','随机置换'],['second-chance','第二次机会 / Clock']],
 '访问页面后检查物理帧。OPT 需要完整未来序列；LFU 只累计当前驻留期间频次；随机置换按固定种子重现。',
 [field('refs','页面访问序列','7 0 1 2 0 3 0 4 2 3 0 3 2'),field('frames','物理帧数','3'),field('seed','随机种子','408')],pages,'pages');
add('分区与连续分配',[['mft','MFT 固定分区'],['mvt','MVT 可变分区'],['first-fit','首次适应 First Fit'],['best-fit','最佳适应 Best Fit'],['worst-fit','最坏适应 Worst Fit'],['next-fit','循环首次适应 Next Fit']],
 '每个数字是一个分区或空闲块。MFT 每块最多装一个进程；MVT 按 First Fit 切割。Next Fit 从上次分配后的余块继续搜索。',
 [field('blocks','分区 / 空闲块大小','100 500 200 300 600'),field('jobs','进程请求大小','212 417 112 426')],memory,'memory');
add('磁盘调度',[['disk-fcfs','FCFS 磁盘调度'],['sstf','SSTF 最短寻道'],['scan','SCAN 电梯'],['cscan','C-SCAN 循环扫描'],['look','LOOK'],['clook','C-LOOK'],['lifo','LIFO 后进先服务'],['rss','RSS 随机服务']],
 '修改柱面请求并比较磁头路线。SCAN / C-SCAN 访问边界，LOOK / C-LOOK 在最远请求处转向；循环回程也计移动量。',
 [field('requests','请求队列','98 183 37 122 14 124 65 67'),field('head','起始柱面','53'),field('max','最大柱面（含）','199'),{key:'direction',label:'初始方向',value:'up',choices:[['up','向大柱面'],['down','向小柱面']]},field('seed','随机种子','408')],disk,'disk');
add('死锁',[['banker','银行家安全性检查']], 'Need = Max − Allocation。找出可完成进程，释放资源后继续检查；不安全不等于已死锁。',
 [field('allocation','已分配 Allocation','0 1 0\n2 0 0\n3 0 2\n2 1 1\n0 0 2'),field('demand','最大需求 Max','7 5 3\n3 2 2\n9 0 2\n2 2 2\n4 3 3'),field('available','可用 Available','3 3 2')],banker,'banker');
add('死锁',[['banker-request','银行家资源申请']], '输入某个进程的申请向量，检查需求和可用量，再试分配、安全性检查与提交 / 回滚。',
 [field('allocation','已分配 Allocation','0 1 0\n2 0 0\n3 0 2\n2 1 1\n0 0 2'),field('demand','最大需求 Max','7 5 3\n3 2 2\n9 0 2\n2 2 2\n4 3 3'),field('available','可用 Available','3 3 2'),field('pid','申请进程号（0 起）','1'),field('request','资源请求 Request','1 0 2')],bankerRequest,'banker');
add('死锁',[['detection','死锁检测']], 'Request 是当前未满足请求。忽略不占资源的进程，逐步找出无法释放资源的集合。',
 [field('allocation','已分配 Allocation','1 0\n0 1'),field('demand','当前请求 Request','0 1\n1 0'),field('available','可用 Available','0 0')],banker,'banker');
add('进程同步',[['producer','生产者 / 消费者']], '缓冲区满时生产者等待，空时消费者等待。操作按输入顺序执行；阻塞操作需后续显式重试。',
 [field('capacity','缓冲容量','3'),field('actions','操作序列','produce A\nproduce B\nconsume\nproduce C\nconsume','produce 值 / consume，每行一个操作')],sync,'sync');
add('进程同步',[['readers','读者 / 写者']], '多个读者可并行；写者必须独占。采用读者优先，适合观察饥饿与互斥。',
 [field('actions','操作序列','read 0\nread 1\nwrite 0\nread_end 0\nread_end 1\nwrite 0\nwrite_end 0','read / read_end / write / write_end 后接进程号')],sync,'sync');
add('进程同步',[['philosophers','哲学家进餐']], 'take 原子获取两叉，避免持有并等待；left 只拿左叉，可构造死锁。',
 [field('capacity','哲学家数','5'),field('actions','操作序列','take 0\ntake 1\ntake 2\nrelease 0\ntake 4','take / left / release 后接 0 起编号')],sync,'sync');
add('进程同步',[['smokers','吸烟者问题']], '供应者提供两种材料，持第三种材料的吸烟者才能继续。',
 [field('actions','操作序列','supply tobacco paper\nsmoke match\nsupply paper match\nsmoke tobacco','材料：tobacco / paper / match')],sync,'sync');
add('系统调用',[['system','fork / exec / wait / exit']], '用命令序列观察进程树、阻塞与僵尸进程。PID 1 是常驻回收进程，不支持退出；先 fork 子进程再演示 exit。仅作模型模拟。',
 [field('actions','操作序列','fork 1\nexec 2 child\nwait 1\nexit 2 0','fork PID；exec PID 程序名；wait PID；exit PID 退出码')],systemCalls,'system');
add('文件分配',[['contiguous','连续分配'],['linked','链接分配'],['indexed','索引分配'],['inode','inode 直接与间接索引']],
 '可设置已占用块，连续分配要求相邻空闲区；索引块也占磁盘空间。inode 模型使用 4 个直接指针和一个单级间接块。',
 [field('diskSize','磁盘块数','24'),field('occupied','已占用块（可空）','2 5 11'),field('actions','文件操作','create alpha 5\ncreate beta 3\ndelete alpha\ncreate gamma 4','create 文件名 数据块数 / delete 文件名')],files,'file');
add('目录组织',[['directory','单级与树形目录']], '在内存目录模型中创建、查找、删除文件，进入子目录并查看完整目录树。',
 [field('actions','目录操作','mkdir notes\ncd notes\ncreate os.txt\nfind os.txt\ncd ..\ntree','mkdir / cd / create / delete / find 名称；ls / tree')],directory,'file');
add('地址转换',[['paging-allocation','分页分配与内部碎片']], '把进程拆成页，建立页到物理帧的对应关系，核算末页内部碎片；整进程装入。',
 [field('total','总内存（字节）','8192'),field('pageSize','页 / 帧大小（字节）','1024'),field('jobs','进程大小（字节）','1500 2100 500 3000')],pagingAllocation,'address');
add('地址转换',[['paging','页表查找与缺页'],['tlb','TLB 地址转换']], '给定页表与页大小，计算物理地址。-1 表示有效但未驻留；越界页号是非法访问。TLB 使用 LRU 淘汰。',
 [field('pageSize','页大小（字节）','1024'),field('table','页表帧号','3 5 -1 2'),field('addresses','虚拟地址序列','12 1040 20 2100 3100'),field('capacity','TLB 容量','2')],address,'address');
add('地址转换',[['segmentation','分段地址与越界']], '逐项核对段号和偏移。偏移必须小于段长，物理地址 = 基址 + 偏移。',
 [field('table','段表（基址 长度）','1000 200\n4000 500\n8000 100'),field('addresses','逻辑地址（段号 偏移）','0 100\n1 500\n2 20')],address,'address');
add('地址转换',[['compaction','内存紧凑']], '把可重定位的占用段向低地址移动，合并空洞。负数代表空洞，正数代表占用。',
 [field('segments','内存布局','100 -50 200 -100 80 -40')],address,'memory');
export const EXPERIMENTS=all;
export const defaults=(e:Experiment):Inputs=>Object.fromEntries(e.fields.map(f=>[f.key,f.value]));
