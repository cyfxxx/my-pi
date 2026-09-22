/**
 * 工具分层与按需加载（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-context/tool-groups.ts`。
 *
 * 背景：全部扩展工具 schema 每轮注入成本随工具数线性增长。
 * 方案：核心工具 schema 常驻；休眠工具组不注入 schema，仅在 system prompt
 * 保留一行简介，需要时由模型调用 `enable_tool("<组名>")` 启用（本会话内保持）。
 *
 * 关键约束：
 * 1. 工具 schema 是 API 请求级状态，enable_tool 是唯一入口（改 setActiveTools）。
 * 2. 工具列表变化 = 前缀缓存断裂；enable 是低频显式操作，禁止每轮动态启停。
 * 3. 启用状态是进程内存态，重启恢复默认分层。
 * 4. 名单维护：未列入任何组的未知工具（未来新扩展）默认保留核心，
 *    computeActiveTools 用全集减去休眠组，不依赖名单完整性。
 */

export interface ToolGroup {
  name: string;
  /** 1 行简介（注入 system prompt 与 /tools list 展示） */
  description: string;
  tools: string[];
}

/** 核心常驻工具（schema 每轮完整注入；仅用于报告，实际以全集减休眠组计） */
export const CORE_TOOLS: string[] = [
  // 内置（文件操作核心）
  'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls',
  // plan-mode：任务追踪入口
  'todo',
  // subagent：委派核心能力
  'subagent',
  // memory（高频核心）
  'memory_store', 'memory_search', 'memory_forget',
  // web-search：搜索与独立 HTTP 获取
  'web_search', 'fetch_url',
  // tmux（核心操作）
  'tmux_run', 'tmux_read', 'tmux_stop',
  // voice：听写转写为核心
  'voice_transcribe',
];

/** 休眠工具组（schema 不注入；enable_tool("<name>") 启用，本会话内保持） */
export const SLEEPING_GROUPS: ToolGroup[] = [
  {
    name: 'browser-core',
    description: '浏览器基础：导航/执行/点击（3 工具）',
    tools: ['browser_navigate', 'browser_evaluate', 'browser_click'],
  },
  {
    name: 'browser-advanced',
    description: '浏览器高级：等待/网络请求/Shadow DOM 查找（3 工具）',
    tools: ['browser_wait_for', 'browser_network', 'browser_find'],
  },
  {
    name: 'browser-full',
    description: '浏览器完整：截图/类型/滚动/提取/选择/对话/下载/上传/Cookie/关闭/PDF/帮助（12 工具）',
    tools: [
      'browser_screenshot', 'browser_type', 'browser_scroll', 'browser_extract',
      'browser_select_option', 'browser_dialog', 'browser_download', 'browser_upload',
      'browser_cookies', 'browser_close', 'browser_pdf', 'browser_help',
    ],
  },
  {
    name: 'memory-advanced',
    description: '记忆扩展：历史召回/统计（2 工具）',
    tools: ['memory_recall', 'memory_stats'],
  },
  {
    name: 'tmux-advanced',
    description: 'Tmux 扩展：状态查询/发送输入/等待完成（3 工具）',
    tools: ['tmux_status', 'tmux_send', 'tmux_wait'],
  },
  {
    name: 'autopilot',
    description: '自主运行：状态/遥测/failover（3 工具）',
    tools: ['autopilot_status', 'autopilot_stats', 'autopilot_failover'],
  },
  {
    name: 'link',
    description: '多设备互联：跨设备发送/状态（2 工具）',
    tools: ['link_send', 'link_status'],
  },
  {
    name: 'voice',
    description: '语音扩展：朗读/录音（2 工具）',
    tools: ['voice_speak', 'voice_record'],
  },
  {
    name: 'web-fallback',
    description: '降级搜索：无 SearXNG 时的 HTTP 搜索备选（1 工具）',
    tools: ['web_fetch'],
  },
];

/** 分组完整性校验：核心与休眠无重叠（测试用） */
export function validateGroups(): { overlap: string[]; emptyGroups: string[] } {
  const coreSet = new Set(CORE_TOOLS);
  const overlap = SLEEPING_GROUPS.flatMap((g) => g.tools.filter((t) => coreSet.has(t)));
  const emptyGroups = SLEEPING_GROUPS.filter((g) => g.tools.length === 0).map((g) => g.name);
  return { overlap, emptyGroups };
}

/**
 * 休眠工具组静态简介（注入 system prompt）。
 * 缓存友好：内容只依赖组定义（不依赖启用状态），启用轮之前前缀完全稳定。
 */
export function buildSleepingSummary(): string {
  const lines = ['## 休眠工具组（默认不注入 schema；需要时用 enable_tool("<组名>") 启用，本会话内保持，重启恢复默认）'];
  for (const g of SLEEPING_GROUPS) {
    lines.push(`- ${g.name}: ${g.description}`);
  }
  lines.push('启用会使工具列表更新一次（前缀缓存重算），属低频显式操作；已启用的组再次 enable 无副作用。');
  return lines.join('\n');
}

/**
 * 计算活动工具集：全部已注册工具减去"未启用的休眠组"工具。
 * 未知工具（不在任何名单）自动保留 → 未来新扩展默认核心，无需维护名单。
 */
export function computeActiveTools(
  allToolNames: string[],
  enabledGroups: ReadonlySet<string>,
): string[] {
  const excluded = SLEEPING_GROUPS.filter((g) => !enabledGroups.has(g.name)).flatMap((g) => g.tools);
  const excludedSet = new Set(excluded);
  return allToolNames.filter((n) => !excludedSet.has(n));
}
