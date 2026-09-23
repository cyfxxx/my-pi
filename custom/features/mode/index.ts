/**
 * Mode Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 模式 = 启动档位：功能白名单 / 思考档位 / 人设追加 / 记忆命名空间。
 * full、minimal 为代码内固定的锁定模式；roleplay 等自定义模式在 modes.json。
 * 功能与人设变更需重启（由 supervisor 消费 modes.json 后重拉），思考档位即时生效。
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
  applyModeRuntime,
  modeFeaturesLabel,
} from './logic';

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
  功能 / 人设 / 记忆命名空间的变更需重启 pi 才能生效；思考档位可立即生效。
  自定义模式在 portable/agent/modes.json 中维护（full/minimal 由代码锁定）。`;

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
      setCurrentMode(subcmd);
      const result = applyModeRuntime(config, activeConfig, currentThinking);

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
        lines.push('', '以下配置将在重启 pi 后生效:');
        for (const change of result.changes) lines.push(`  - ${change}`);
        lines.push('', '请使用 /exit 退出后重新启动 pi');
      } else if (result.thinkingChanged) {
        lines.push(`思考级别已调整为: ${config.thinking}`);
      } else {
        lines.push('无需重启，配置已生效');
      }
      ctx.ui.notify(lines.join('\n'), 'info');
    },
  });

  // 会话启动时显示当前模式（full 不提示）
  registerHook(pi, {
    event: 'session_start',
    handler: async (_event, ctx) => {
      if (activeMode === 'full' || !ctx.hasUI) return;
      ctx.ui.notify(`[模式] ${activeMode}: ${activeConfig.description}`, 'info');
    },
  });
}
