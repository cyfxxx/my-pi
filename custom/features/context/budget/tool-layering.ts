/**
 * 工具分层运行态（feature 内部模块）
 *
 * 持有启用组状态并调用适配器切换活跃工具。位于 features 下但 import 的是
 * 本地适配器（非 Pi 包），符合隔离约束（check-isolation 检查 3/4）。
 */

import type { PiApi } from '../../../adapters/ui-adapter';
import { getAllToolNames, getActiveTools, setActiveTools } from '../../../adapters/ui-adapter';
import {
  CORE_TOOLS,
  SLEEPING_GROUPS,
  effectiveActiveTools,
  buildSleepingSummary,
  groupsWithTools,
} from './tool-groups';
import { TOOL_LAYERING } from './task-gate';

/** 已启用工具组（进程内存态；仅在 TOOL_LAYERING=on 时参与裁剪） */
export const enabledGroups = new Set<string>();

/**
 * 活动工具集基线：**第一次动手之前** pi 自己激活的工具（`getActiveTools()`）。
 *
 * 这是"不激活 pi 刻意休眠的工具"的落点——my-pi 只在这个集合上做减法（裁未启用休眠组）
 * 与"把显式 enable 的组加回来"，从不反过来拿"全部已注册工具"当基线（那会把
 * `defaultActive: false` 的 `tool_search`/`codemode` 和 POSIX 上没用的 `powershell` 一起激活，
 * 见 `tool-groups.ts` 的"设计说明"）。基线只在首次应用前抓一次：之后本模块自己改过活动集，
 * 再抓就会把裁剪结果当成基线，越裁越窄或反复横跳。
 */
let baseActiveToolNames: string[] | null = null;

/**
 * 应用工具集：按需加载开启时裁掉未启用休眠组；默认（关闭）**完全不动** pi 的工具集。
 *
 * 只有目标集合与当前活跃集合**不同**时才调用 `setActiveTools`：工具数组位于请求最前部，
 * 一次变更会使 system prompt 与整段消息前缀全部失效（实测单次 140K–250K 全价重算，
 * 2026-09-26 四次 `enable_tool` 各触发一次）。空操作调用在这里是纯代价。
 */
export function applyToolLayering(pi: PiApi): void {
  if (!TOOL_LAYERING) return; // 常驻 = 不动 pi 的选择（连一次空操作调用都省掉）
  if (baseActiveToolNames === null) baseActiveToolNames = getActiveTools(pi);
  const target = effectiveActiveTools(baseActiveToolNames, enabledGroups, true);
  if (sameToolSet(getActiveTools(pi), target)) return;
  setActiveTools(pi, target);
}

/** 工具集合比较：顺序无关（顺序变化同样破坏前缀缓存，故按排序后比较） */
function sameToolSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

/** 是否存在"已启用但处于休眠名单"的工具（用于计划模式退出等场景自愈） */
export function dormantToolsActive(pi: PiApi): boolean {
  if (!TOOL_LAYERING) return false; // 全部常驻时不存在"休眠工具"，也无需自愈回调
  const current = new Set(getActiveTools(pi));
  return SLEEPING_GROUPS.some((g) => !enabledGroups.has(g.name) && g.tools.some((t) => current.has(t)));
}

/** 当前已注册工具集（用于过滤未迁移功能的分组） */
function presentToolSet(pi: PiApi): Set<string> {
  return new Set(getAllToolNames(pi));
}

/** 启用某个休眠组，返回结果说明（只允许启用"当前有已注册工具"的组） */
export function enableGroup(pi: PiApi, name: string): { ok: boolean; message: string } {
  if (!TOOL_LAYERING) {
    return {
      ok: false,
      message:
        '工具按需加载已关闭（默认）：全部工具 schema 常驻，无需启用任何组。' +
        '如需恢复休眠分层，设 PI_CONTEXT_TOOL_LAYERING=on 后重启。',
    };
  }
  const group = SLEEPING_GROUPS.find((g) => g.name === name);
  if (!group) {
    const available = groupsWithTools(presentToolSet(pi)).map((g) => g.name);
    return { ok: false, message: `未知工具组: ${name || '(空)'}。可用组: ${available.join(', ')}` };
  }
  const present = presentToolSet(pi);
  const tools = group.tools.filter((t) => present.has(t));
  if (tools.length === 0) {
    return { ok: false, message: `工具组 ${group.name} 暂无已注册工具（对应功能尚未迁移到 my-pi）。` };
  }
  if (enabledGroups.has(group.name)) {
    return { ok: true, message: `工具组 ${group.name} 已在启用状态（${tools.join(', ')}），无操作。` };
  }
  enabledGroups.add(group.name);
  applyToolLayering(pi);
  return {
    ok: true,
    message: `已启用工具组 ${group.name}: ${tools.join(', ')}。本会话内保持可用；重启 pi 后恢复默认分层。`,
  };
}

/** 生成 /tools list 报告（只展示当前已注册的工具/分组） */
export function buildToolsReport(pi: PiApi): string {
  const present = presentToolSet(pi);
  const active = new Set(getActiveTools(pi));
  if (!TOOL_LAYERING) {
    return [
      '## 工具状态：全部常驻（按需加载已关闭）',
      `活跃 ${active.size} 个 / 已注册 ${present.size} 个` +
        `（差值 = pi 刻意休眠或本平台不可用的工具，my-pi 不激活）`,
      `分组定义仍保留 ${groupsWithTools(present).length} 个（休眠名单不生效）；`,
      '恢复休眠分层：设 PI_CONTEXT_TOOL_LAYERING=on 后重启。',
    ].join('\n');
  }
  const core = CORE_TOOLS.filter((t) => present.has(t));
  const groups = groupsWithTools(present);
  const lines = ['## 工具分层状态'];
  lines.push(`核心常驻（${core.length}）: ${core.join(', ')}`);
  for (const g of groups) {
    const state = enabledGroups.has(g.name) ? '已启用' : '休眠';
    const tools = g.tools.filter((t) => present.has(t));
    lines.push(`- ${g.name} [${state}]（${tools.length}）: ${tools.join(', ')}`);
  }
  lines.push(`当前活动工具: ${active.size} 个`);
  return lines.join('\n');
}

export { buildSleepingSummary };
