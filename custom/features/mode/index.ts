/**
 * Mode Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/pi-mode/{index,commands}.ts`。
 * 模式配置读写 portable/agent/modes.json；运行时改思考级别，其余变更需重启。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerCommand, getThinkingLevel, setThinkingLevel } from '../../adapters/ui-adapter';
import {
  loadModes,
  getCurrentMode,
  getModeConfig,
  setCurrentMode,
  listModeNames,
  getDefaultMode,
  applyModeRuntime,
  needsRestart,
} from './logic';

const MODE_HELP = `用法:
  /mode              显示当前模式
  /mode list         列出所有可用模式
  /mode <name>       切换到指定模式
  /mode help         显示本帮助

可用模式:
  full    完整模式 - 所有扩展和技能可用
  light   轻量模式 - 只保留搜索、计划模式和基础工具
  quick   极简模式 - 只保留内置工具，无扩展无技能

注意:
  扩展/技能/系统提示词变更需要重启 pi 才能生效。
  思考级别可立即生效。

自定义模式:
  编辑 portable/agent/modes.json 添加自定义模式配置。`;

export function register(pi: ExtensionAPI): void {
  registerCommand(pi, 'mode', {
    description: '查看/切换当前模式 (usage: /mode <list|name|help>)',
    getArgumentCompletions: (prefix) => {
      const first = (prefix?.trim().split(/\s+/)[0] ?? '').toLowerCase();
      const items = [
        { value: 'list', label: 'list', description: '列出所有可用模式' },
        { value: 'help', label: 'help', description: '显示帮助信息' },
        ...listModeNames().map((name) => ({
          value: name,
          label: name,
          description: (getModeConfig(name) || { description: '' }).description,
        })),
      ];
      return prefix?.includes(' ') ? items : items.filter((i) => i.value.startsWith(first));
    },
    handler: async (args, ctx) => {
      const subcmd = (args.trim().split(/\s+/)[0] || '').toLowerCase();

      if (subcmd === 'help' || subcmd === '-h' || subcmd === '--help') {
        ctx.ui.notify(MODE_HELP, 'info');
        return;
      }

      if (subcmd === 'list') {
        const modes = loadModes();
        const lines: string[] = ['可用模式:', ''];
        for (const [name, config] of Object.entries(modes.modes)) {
          const current = name === modes.current ? ' (当前)' : '';
          const extCount = config.extensions.filter((e) => !e.startsWith('!')).length;
          const skillCount = config.skills.filter((s) => !s.startsWith('!') && !s.startsWith('-')).length;
          lines.push(`  ${name}${current}: ${config.description}`);
          lines.push(`    覆盖: ${extCount} 扩展, ${skillCount} 技能${needsRestart(config) ? ' [需重启]' : ''}`);
        }
        lines.push('', '使用 /mode <name> 切换模式');
        ctx.ui.notify(lines.join('\n'), 'info');
        return;
      }

      if (!subcmd) {
        const currentName = getCurrentMode();
        const config = getModeConfig(currentName);
        ctx.ui.notify(
          `当前模式: ${currentName}\n描述: ${config?.description || '未知'}\n默认模式: ${getDefaultMode()}\n\n使用 /mode <name> 切换，/mode list 查看全部，/mode help 查看帮助`,
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
      const result = applyModeRuntime(config, currentThinking);

      if (result.thinkingChanged && config.thinking) {
        try {
          setThinkingLevel(pi, config.thinking);
        } catch {
          /* 切换失败不阻塞 */
        }
      }

      const lines: string[] = [`已切换到模式: ${subcmd}`];
      if (config.description) lines.push(`描述: ${config.description}`);
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
      const modeName = process.env.PI_AGENT_MODE || getCurrentMode();
      if (!modeName || modeName === 'full') return;
      const config = getModeConfig(modeName);
      if (!config || !ctx.hasUI) return;
      ctx.ui.notify(`[模式] ${modeName}: ${config.description}`, 'info');
    },
  });
}
