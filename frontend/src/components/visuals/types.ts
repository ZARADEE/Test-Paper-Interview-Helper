export interface SortFrame {
  /** 当前数组状态 */
  arr: Array<number | string>
  /** 本步说明（一句话） */
  note: string
  /** 基准 / 关键值所在下标（黄色高亮格） */
  pivot?: number
  /** 正在比较的下标（主题色高亮） */
  compared?: number[]
  /** 刚交换 / 已就位的下标（绿色高亮） */
  settled?: number[]
  /** 当前处理区间 [lo, hi]（下划线标出） */
  range?: [number, number]
}

/** 二叉树 / 森林构造过程：BST 插入、AVL 旋转、哈夫曼合并、堆建堆等 */
export interface TreeStep {
  /** 本步树的全部节点（parent 形成森林；label 为显示文本） */
  nodes: Array<{ id: string; label: string; parent?: string }>
  /** 高亮节点 id */
  highlight?: string[]
  /** 本步说明 */
  note: string
}

/** 带权图算法：Dijkstra / Prim / Kruskal / 拓扑排序等 */
export interface GraphSpec {
  kind: 'graph'
  title: string
  /** 节点坐标（0–100 归一化画布） */
  nodes: Array<{ id: string; x: number; y: number }>
  /** 边；directed 时画箭头 */
  edges: Array<{ from: string; to: string; w?: number; directed?: boolean }>
  /** 演进步骤 */
  steps: Array<{
    /** 激活的边 'from-to'（如 'A-B'） */
    activeEdges?: string[]
    /** 激活 / 已确定的节点 */
    activeNodes?: string[]
    /** 节点旁的临时标注，如距离 { A: '0', B: '∞→10' } */
    labels?: Record<string, string>
    note: string
  }>
}

/** 页面置换过程（FIFO/LRU/CLOCK/OPT 由组件精确模拟） */
export interface PagesSpec {
  kind: 'pages'
  title: string
  algo: 'FIFO' | 'LRU' | 'CLOCK' | 'OPT'
  /** 页框数 */
  frames: number
  /** 访问序列，如 ['1','2','3','4','1','2','5','1','2','3','4','5'] */
  accesses: string[]
}

/** TCP 拥塞窗口演化折线 */
export interface CwndSpec {
  kind: 'cwnd'
  title: string
  /** 每轮拥塞窗口值；event 标注事件（如 '超时'、'3-ACK'） */
  points: Array<{ round: number; cwnd: number; ssthresh?: number; event?: string }>
}

/** 指令流水线时空图 */
export interface PipelineSpec {
  kind: 'pipeline'
  title: string
  /** 各段名称，如 ['IF','ID','EX','MEM','WB'] */
  stages: string[]
  /** 指令；delay = 进入首段的拍号（0 起，含停顿），组件自动铺满各段 */
  instrs: Array<{ name: string; delay: number; note?: string }>
}

/** 协议时序图：握手挥手、ARP、DNS、HTTP、DHCP、访问全过程等 */
export interface SeqSpec {
  kind: 'seq'
  title: string
  /** 2–4 个角色，如 ['客户', '服务器'] */
  actors: string[]
  /** 消息按时间序逐步展示 */
  messages: Array<{ from: string; to: string; label: string }>
}

/** 流程图：缺页处理、中断处理、PV 操作、地址变换等 */
export interface FlowSpec {
  kind: 'flow'
  title: string
  nodes: Array<{ id: string; label: string; type: 'start' | 'proc' | 'cond' | 'end' }>
  edges: Array<{ from: string; to: string; label?: string }>
}

export type VisualSpec =
  | ({ kind: 'sort'; title: string; frames: SortFrame[] })
  | ({ kind: 'tree'; title: string; steps: TreeStep[] })
  | GraphSpec
  | PagesSpec
  | CwndSpec
  | PipelineSpec
  | SeqSpec
  | FlowSpec
