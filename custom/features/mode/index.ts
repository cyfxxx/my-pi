/**
 * Mode Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 模式 = 启动档位：功能白名单 / 思考档位 / 人设追加 / 记忆命名空间。
 * full、minimal 为代码内固定的锁定模式；roleplay 等自定义模式定义在 modes.json。
 * 功能与人设变更需重启：`/mode <name>` 会自动提交重启请求（带 --session 续接当前会话），
 * 由 supervisor 重新注入人设与记忆命名空间；思考档位即时生效。
 *
 * **模式的作用域是会话**（2026-10-06 起）：新会话用 modes.json 的 default，续接会话用它
 * 自己记录的模式（modes-sessions.json，gitignored），`/mode` 只影响当前会话。配置与会话
 * 记录分文件，避免"切模式后被 git 操作静默回退"（详见 logic.ts）。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerCommand, getThinkingLevel, setThinkingLevel } from '../../adapters/ui-adapter';
import { parseSubcommand, filterCompletions } from '../../core/cli';
import {
  loadModes,
  getModeConfig,
  getSessionMode,
  setSessionMode,
  listModeNames,
  getDefaultMode,
  isLockedMode,
  resolveEffectiveMode,
  getEffectiveModeConfig,
  isModeForcedByEnv,
  shouldRequestModeRestart,
  applyModeRuntime,
  modeFeaturesLabel,
} from './logic';
// 重启请求由 supervisor 消费，属跨功能基础设施；本项目约定跨功能引用只走对方 logic.ts。
// （若将来出现第三个消费者，应上移到 custom/core/。）
import { writeRestartRequest } from '../autopilot/logic';

const MODE_HELP = `用法:
  /mode              显示当前模式
  /mode list         列出所有可用模式
  /mode <name>       切换到指定模式
  /mode help         显示本帮助

模式:
  full      完整模式 - 全部功能（开发项目，固定）
  minimal   极简模式 - 仅内置工具（测试/修复，固定）
  roleplay  标枪（秘书舰·已誓约）- web-search + 隔离记忆（自定义人设）

注意:
  功能 / 人设 / 记忆命名空间的变更需重启 pi 才能生效——用 /mode <name> 切换时会**自动重启**
  并续接当前会话（不是热切换：pi 在启动时注册工具，无法运行时卸载）。
  思考档位可立即生效，无需重启。
  **模式只作用于当前会话**：新会话用 modes.json 的 default，续接会话用它自己上次的模式；
  自定义模式在 portable/agent/modes.json 中维护（full/minimal 由代码锁定）；
  会话与模式的对应关系存在 portable/agent/modes-sessions.json（不入库）。`;

export function register(pi: ExtensionAPI): void {
  const activeMode = resolveEffectiveMode();
  const activeConfig = getEffectiveModeConfig();

  registerCommand(pi, 'mode', {
    description: '查看/切换当前模式（仅作用于当前会话）',
    getArgumentCompletions: (prefix) => {
      const first = parseSubcommand(prefix).sub;
      const items = [
        { value: 'list', label: 'list', description: '列出所有可用模式' },
        { value: 'help', label: 'help', description: '显示帮助信息' },
        ...listModeNames().map((name) => ({
          value: name,
          label: name,
          description: (getModeConfig(name) || { description: '' }).description,
        })),
      ];
      return prefix?.includes(' ') ? items : filterCompletions(items, first);
    },
    handler: async (args, ctx) => {
      const { sub: subcmd } = parseSubcommand(args);
      const sessionFile = sessionFileOf(ctx);
      const currentName = getSessionMode(sessionFile) ?? getDefaultMode();

      if (subcmd === 'help' || subcmd === '-h' || subcmd === '--help') {
        ctx.ui.notify(MODE_HELP, 'info');
        return;
      }

      if (subcmd === 'list') {
        const modes = loadModes();
        const lines: string[] = ['可用模式:', ''];
        for (const [name, config] of Object.entries(modes.modes)) {
          const marks: string[] = [];
          if (name === currentName) marks.push('当前');
          if (isLockedMode(name)) marks.push('固定');
          lines.push(`  ${name}${marks.length ? ` (${marks.join('/')})` : ''}: ${config.description}`);
          lines.push(`    ${modeFeaturesLabel(config)}`);
        }
        lines.push('', '使用 /mode <name> 切换模式（只影响当前会话），/mode help 查看作用域说明');
        ctx.ui.notify(lines.join('\n'), 'info');
        return;
      }

      if (!subcmd) {
        const config = getModeConfig(currentName);
        ctx.ui.notify(
          `当前会话模式: ${currentName}\n描述: ${config?.description || '未知'}\n` +
            `默认模式（新会话）: ${getDefaultMode()}\n本进程生效: ${activeMode}\n\n` +
            `使用 /mode <name> 切换（只影响当前会话），/mode list 查看全部，/mode help 查看帮助`,
          'info',
        );
        return;
      }

      const config = getModeConfig(subcmd);
      if (!config) {
        ctx.ui.notify(`未知模式: "${subcmd}"\n可用模式: ${listModeNames().join(', ')}`, 'error');
        return;
      }

      const currentThinking = getThinkingLevel(pi);
      const result = applyModeRuntime(config, activeConfig, currentThinking);

      // 需要重启时先确认空闲：响应进行中就把状态写掉会造成"半切换"（配置已改、进程没重启），
      // 比不切更难排查。这里什么都不落盘，让用户等本轮结束后重跑一次即可。
      // （pi 自己的 /reload 也有同样的保护："Wait for the current response to finish"。）
      if (result.needsRestart && !ctx.isIdle()) {
        ctx.ui.notify(
          `当前有响应正在进行中，未切换模式（避免半切换状态）。\n` +
            `等本轮结束后重跑：/mode ${subcmd}`,
          'warning',
        );
        return;
      }

      // 会话不落盘（--no-session / 内存会话）时没有"按会话记忆"的落点：功能集靠重启才能换，
      // 而重启会丢掉这个临时会话，所以只做能做的（思考档位）并说清限制，不写任何状态。
      if (result.needsRestart && !sessionFile) {
        if (result.thinkingChanged && config.thinking) {
          try {
            setThinkingLevel(pi, config.thinking);
          } catch {
            /* 切换失败不阻塞 */
          }
        }
        ctx.ui.notify(
          `当前会话不落盘（--no-session），无法按会话记录模式。\n` +
            `本进程内功能集无法热切换：请退出后以 PI_AGENT_MODE=${subcmd} 重启，` +
            `或把 modes.json 的 default 改成 ${subcmd} 再启动。`,
          'warning',
        );
        return;
      }

      if (sessionFile) setSessionMode(sessionFile, subcmd); // 确认要切了才持久化

      if (result.thinkingChanged && config.thinking) {
        try {
          setThinkingLevel(pi, config.thinking);
        } catch {
          /* 切换失败不阻塞 */
        }
      }

      const lines: string[] = [`已切换到模式: ${subcmd}（仅本会话）`];
      if (config.description) lines.push(`描述: ${config.description}`);
      lines.push(modeFeaturesLabel(config));
      if (result.needsRestart) {
        lines.push('', '以下配置需要重启才能生效，正在自动重启并续接当前会话：');
        for (const change of result.changes) lines.push(`  - ${change}`);
        ctx.ui.notify(lines.join('\n'), 'info');
        requestModeRestart(ctx, subcmd);
        return;
      }
      if (result.thinkingChanged) {
        lines.push(`思考级别已调整为: ${config.thinking}`);
      } else {
        lines.push('无需重启，配置已生效');
      }
      ctx.ui.notify(lines.join('\n'), 'info');
    },
  });

  // 会话启动时：先按**本会话**应有的模式做一致性校验（不一致就自愈重启），再显示当前模式。
  registerHook(pi, {
    event: 'session_start',
    handler: async (_event, ctx) => {
      // 会话应有的模式：本会话的记录，没有记录就是 default（新会话）。
      const sessionFile = sessionFileOf(ctx);
      const recorded = getSessionMode(sessionFile);
      const intended = recorded ?? getDefaultMode();

      // 覆盖的正是"切了模式、重启后没生效"这一类**静默**状态：配置被 git 操作回退、
      // 多设备覆盖、手工改了配置却没重启，以及 bash 侧解析不出会话（-c / -r / 部分 uuid）。
      // 外部硬覆盖（source=env）跳过——那是用户/测试的显式强制，不是异常。
      const mismatched = !isModeForcedByEnv() && intended !== activeMode;
      if (mismatched) {
        if (!ctx.hasUI) {
          // 无 UI（headless -p / RPC）：重启会打断本次非交互运行，只留下可排查的告警。
          console.warn(
            `[模式] 本会话应使用 ${intended}，本进程以 ${activeMode} 运行（headless 不自动重启）`,
          );
          return;
        }
        if (shouldRequestModeRestart(sessionFile ?? '', intended)) {
          ctx.ui.notify(
            `[模式] 本会话应使用 ${intended}，本进程以 ${activeMode} 运行：正在自动重启并按会话模式续接…`,
            'warning',
          );
          requestModeRestart(ctx, intended);
          return;
        }
        ctx.ui.notify(
          `[模式] 本会话应使用 ${intended}，本进程为 ${activeMode}；刚刚已尝试自动重启仍未生效。` +
            `\n请手动执行 /mode ${intended}，或检查 modes-sessions.json 与会话路径是否对得上。`,
          'warning',
        );
      }
      if (!ctx.hasUI) return;
      if (activeMode === 'full') return;
      ctx.ui.notify(`[模式] ${activeMode}: ${activeConfig.description}`, 'info');
    },
  });
}

/** 当前会话文件（内存会话 / --no-session 返回 undefined） */
function sessionFileOf(ctx: {
  sessionManager?: { getSessionFile?: () => string | undefined };
}): string | undefined {
  try {
    return ctx.sessionManager?.getSessionFile?.();
  } catch {
    return undefined;
  }
}

/**
 * 提交自动重启请求并退出当前进程。
 *
 * 走的是**既有**的 admin state 通道（`portable/agent/autopilot/state.json`），
 * 由 `scripts/pi-supervisor.sh` 在进程退出后消费：带 `--session` 精确续接当前会话，
 * 回来后 supervisor 已按该会话的模式重新解析（人设 + 记忆命名空间），bootstrap 也重新
 * 按新模式过滤功能。这条路已有 supervisor 测试兜底，不引入新机制。
 */
function requestModeRestart(
  ctx: {
    sessionManager?: { getSessionFile?: () => string | undefined };
    shutdown?: () => void;
  },
  modeName: string,
): void {
  try {
    const sessionFile = sessionFileOf(ctx);
    writeRestartRequest('restart', { targetSession: sessionFile, reason: `切换模式为 ${modeName}` });
  } catch {
    /* 写盘失败时仍尝试退出，由用户手工重启 */
  }
  try {
    ctx.shutdown?.();
  } catch {
    /* 非交互环境无 shutdown */
  }
}
