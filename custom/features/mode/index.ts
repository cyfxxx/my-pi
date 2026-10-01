/**
 * Mode Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 模式 = 启动档位：功能白名单 / 思考档位 / 人设追加 / 记忆命名空间。
 * full、minimal 为代码内固定的锁定模式；roleplay 等自定义模式定义在 modes.json。
 * 功能与人设变更需重启：`/mode <name>` 会自动提交重启请求（带 --session 续接当前会话），
 * 由 supervisor 重新注入人设与记忆命名空间；思考档位即时生效。
 *
 * 配置与状态分离：modes.json（入库）只放 default + 模式定义；当前模式 current 放
 * modes-state.json（gitignored）——避免"切模式后被 git 操作静默回退"（详见 logic.ts）。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerCommand, getThinkingLevel, setThinkingLevel } from '../../adapters/ui-adapter';
import { parseSubcommand, filterCompletions } from '../../core/cli';
import {
  loadModes,
  getCurrentMode,
  getModeConfig,
  setCurrentMode,
  listModeNames,
  getDefaultMode,
  isLockedMode,
  resolveEffectiveMode,
  getEffectiveModeConfig,
  isModeForcedByEnv,
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
  roleplay  角色扮演 - 仅 web-search + 隔离记忆（自定义）

注意:
  功能 / 人设 / 记忆命名空间的变更需重启 pi 才能生效——用 /mode <name> 切换时会**自动重启**
  并续接当前会话（不是热切换：pi 在启动时注册工具，无法运行时卸载）。
  思考档位可立即生效，无需重启。
  自定义模式在 portable/agent/modes.json 中维护（full/minimal 由代码锁定）；
  当前模式是每台机器的运行时状态，存在 portable/agent/modes-state.json（不入库）。`;

export function register(pi: ExtensionAPI): void {
  const activeMode = resolveEffectiveMode();
  const activeConfig = getEffectiveModeConfig();

  registerCommand(pi, 'mode', {
    description: '查看/切换当前模式',
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

      if (subcmd === 'help' || subcmd === '-h' || subcmd === '--help') {
        ctx.ui.notify(MODE_HELP, 'info');
        return;
      }

      if (subcmd === 'list') {
        const modes = loadModes();
        const lines: string[] = ['可用模式:', ''];
        for (const [name, config] of Object.entries(modes.modes)) {
          const marks: string[] = [];
          if (name === modes.current) marks.push('当前');
          if (isLockedMode(name)) marks.push('固定');
          lines.push(`  ${name}${marks.length ? ` (${marks.join('/')})` : ''}: ${config.description}`);
          lines.push(`    ${modeFeaturesLabel(config)}`);
        }
        lines.push('', '使用 /mode <name> 切换模式');
        ctx.ui.notify(lines.join('\n'), 'info');
        return;
      }

      if (!subcmd) {
        const currentName = getCurrentMode();
        const config = getModeConfig(currentName);
        ctx.ui.notify(
          `当前模式: ${currentName}\n描述: ${config?.description || '未知'}\n默认模式: ${getDefaultMode()}\n本进程生效: ${activeMode}\n\n使用 /mode <name> 切换，/mode list 查看全部，/mode help 查看帮助`,
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

      setCurrentMode(subcmd); // 确认要切了才持久化

      if (result.thinkingChanged && config.thinking) {
        try {
          setThinkingLevel(pi, config.thinking);
        } catch {
          /* 切换失败不阻塞 */
        }
      }

      const lines: string[] = [`已切换到模式: ${subcmd}`];
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

  // 会话启动时：先做一致性校验，再显示当前模式
  registerHook(pi, {
    event: 'session_start',
    handler: async (_event, ctx) => {
      if (!ctx.hasUI) return;
      // 一致性校验：磁盘上持久化的模式 vs 本进程实际注册的模式。
      // 覆盖的正是"切了模式、重启后没生效"这类**静默**状态（配置被 git 操作回退、
      // 多设备覆盖、手工改了配置却没重启）。env 强制模式下跳过，避免误报。
      const persisted = getCurrentMode();
      if (!isModeForcedByEnv() && persisted !== activeMode) {
        ctx.ui.notify(
          `[模式] 不一致：磁盘记录为 ${persisted}，本进程实际以 ${activeMode} 运行。\n` +
            `若要用 ${persisted}：/mode ${persisted}（会自动重启并续接当前会话）。`,
          'warning',
        );
      }
      if (activeMode === 'full') return;
      ctx.ui.notify(`[模式] ${activeMode}: ${activeConfig.description}`, 'info');
    },
  });
}

/**
 * 提交自动重启请求并退出当前进程。
 *
 * 走的是**既有**的 admin state 通道（`portable/agent/autopilot/state.json`），
 * 由 `scripts/pi-supervisor.sh` 在进程退出后消费：带 `--session` 精确续接当前会话，
 * 回来后 supervisor 已重新解析模式（人设 + 记忆命名空间），bootstrap 也重新按新模式过滤功能。
 * 这条路已有 44 项 supervisor 测试兜底，不引入新机制。
 */
function requestModeRestart(
  ctx: {
    sessionManager?: { getSessionFile?: () => string | undefined };
    shutdown?: () => void;
  },
  modeName: string,
): void {
  try {
    const sessionFile = ctx.sessionManager?.getSessionFile?.();
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
