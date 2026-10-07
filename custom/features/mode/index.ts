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
import { registerCommand, getThinkingLevel, setThinkingLevel, sendMessage, sendMessageAfterRebind } from '../../adapters/ui-adapter';
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
  isFeatureEnabled,
  applyRoleplayIdentity,
  ROLEPLAY_MODE_NAME,
  formatModeSwitchNotice,
  MODE_NOTICE_TTL_MS,
} from './logic';
// 重启请求由 supervisor 消费，属跨功能基础设施；本项目约定跨功能引用只走对方 logic.ts。
// （若将来出现第三个消费者，应上移到 custom/core/。）
// `readState`/`consumeRestartLog` 只在"取自己那条待注入通知"时用到（见 takePendingModeNotice）。
import { writeRestartRequest, readState, consumeRestartLog } from '../autopilot/logic';
// 兜底：roleplay/lean/minimal 里没注册 autopilot，通用重启日志否则**没人消费**（崩溃恢复后既没有
// 通知也不会续跑，且完全静默）。mode 是唯一恒注册的功能，所以由它代劳。文案/通道选择在 core 里共用。
import {
  formatRestartLine,
  isModeOwnedNoticeLog,
  logTargetsOtherSession,
  logWrittenAfterStart,
  planRestartNotice,
  processStartedAtMs,
  tailKindFromSessionFile,
} from '../../core/restart-intent';

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
        requestModeRestart(ctx, subcmd, activeMode);
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
        if (!sessionFile) {
          // 没有会话文件（--no-session / 内存会话）：没有可精确续接的目标，重启只会把这个
          // 临时会话丢掉，所以只留下可排查的告警。
          console.warn(`[模式] 本会话不落盘，无法按会话自愈（应为 ${intended}，本进程 ${activeMode}）`);
        } else if (!ctx.hasUI) {
          // 无 UI（headless -p / RPC）：重启会打断本次非交互运行，同样只告警。
          console.warn(`[模式] 本会话应使用 ${intended}，本进程以 ${activeMode} 运行（headless 不自动重启）`);
        } else if (shouldRequestModeRestart(sessionFile, intended)) {
          ctx.ui.notify(
            `[模式] 本会话应使用 ${intended}，本进程以 ${activeMode} 运行：正在自动重启并按会话模式续接…`,
            'warning',
          );
          // 原因写清楚是"自愈"而不是"用户切换"：这句只进 state.json 供排查，模型侧的通知
          // 由**新模式进程**按模式生成（见 takePendingModeNotice），不沿用这里的内部措辞。
          requestModeRestart(ctx, intended, activeMode, `按会话模式自愈：本会话应为 ${intended}，进程原为 ${activeMode}`);
          return;
        } else {
          ctx.ui.notify(
            `[模式] 本会话应使用 ${intended}，本进程为 ${activeMode}；刚刚已尝试自动重启仍未生效。` +
              `\n请手动执行 /mode ${intended}，或检查 modes-sessions.json 与会话路径是否对得上。`,
            'warning',
          );
        }
        // 不一致就到此为止：本进程仍在旧档位，既不注入切换通知（会说假话），
        // 也不消费它——留给真正切成功的那一轮（含用户看到告警后自己重启的那次）。
        return;
      }
      if (!ctx.hasUI) return;
      // 刚因模式切换重启过 → 在**新模式进程**里注入模式相关的通知（人设/功能/命名空间都对得上）。
      // 顺序重要：必须在一致性校验之后（不一致的进程仍在旧档位，注入等于说假话），
      // 且必须只注入一次（takePendingModeNotice 消费即清）。
      const notice = takePendingModeNotice(sessionFile);
      if (notice && notice.to === activeMode) {
        try {
          // **零成本通道**：档位切换不需要"接上工作"，注入一条只在下一次真正要跑时出现的上下文备注
          // （deliverAs:'nextTurn' 不触发回合、不写会话文件）。旧行为是 sendUserMessage → 每次切模式
          // 都白跑一个模型回合（实测会话里能看到模型对着通知自问"我该继续做什么"）。
          sendMessage(
            pi,
            {
              customType: 'my-pi-mode-switch',
              content: formatModeSwitchNotice(notice.from, notice.to, getModeConfig(activeMode) ?? activeConfig),
              display: false,
            },
            { deliverAs: 'nextTurn' },
          );
        } catch {
          /* 注入失败不阻塞启动 */
        }
      }
      // 兜底消费"通用"重启日志（非 mode 归属）：本模式没注册 autopilot 时没人管它。
      // 只在不一致校验通过之后（上面已 return）、且只消费一次（consume 即清）。
      if (!isFeatureEnabled('autopilot', activeConfig)) {
        const log = readState().restartLog;
        // 只消费"写给我这个新进程、且目标就是本会话"的日志：写在**本进程启动之后**的日志属于
        // 下一个进程（本进程正是即将被重启的那一个），吃掉它会让重拉起来的新进程无续跑可注入。
        if (
          log &&
          log.action &&
          log.action !== 'none' &&
          !isModeOwnedNoticeLog(log) &&
          !logWrittenAfterStart(log, processStartedAtMs()) &&
          !logTargetsOtherSession(log, sessionFile)
        ) {
          const consumed = consumeRestartLog();
          if (consumed) {
            ctx.ui.notify(formatRestartLine(consumed), 'info');
            const plan = planRestartNotice({
              log: consumed,
              tail: tailKindFromSessionFile(sessionFile),
              env: process.env.PI_RESTART_RESUME,
            });
            try {
              if (plan.channel === 'turn') {
                // 延后触发：避开 pi 会话替换的 rebind 竞态（见 adapters/ui-adapter.ts）
                sendMessageAfterRebind(
                  pi,
                  { customType: plan.customType, content: plan.content, display: true },
                  { isIdle: () => ctx.isIdle() },
                );
              } else {
                sendMessage(pi, { customType: plan.customType, content: plan.content, display: false }, { deliverAs: 'nextTurn' });
              }
            } catch {
              /* 注入失败不阻塞启动 */
            }
          }
        }
      }
      if (activeMode === 'full') return;
      ctx.ui.notify(`[模式] ${activeMode}: ${activeConfig.description}`, 'info');
    },
  });

  // roleplay：把 pi 默认 preamble（"expert coding assistant…"）定点替换为角色身份句。
  // 只在 roleplay 模式注册；锚点与替换规则在 logic.ts（纯函数）。
  if (activeMode === ROLEPLAY_MODE_NAME) {
    registerHook(pi, {
      event: 'before_agent_start',
      handler: (event) => {
        const e = event as { systemPrompt?: string };
        if (typeof e.systemPrompt !== 'string') return;
        const replaced = applyRoleplayIdentity(e.systemPrompt, activeMode);
        if (replaced === e.systemPrompt) return;
        return { systemPrompt: replaced };
      },
    });
  }
}

/**
 * 取出"本次启动是因为模式切换"的待注入通知（**只在新模式进程里调用**）。
 *
 * 写入端是 `requestModeRestart`（旧进程，带 `notice:'mode'`），消费端在这里：
 *   - 只认自己写的标记（`notice === 'mode'`），autopilot 的通用通知也据此让位；
 *   - 只认**写在本进程启动之前**的日志：写在启动之后的属于下一个进程（本进程即将被重启），
 *     吃掉它会让新进程看不到（2026-10-07 真 pty 场景实测：续跑静默丢失）；
 *   - 只认本会话（`targetSession` 对得上），别的会话的通知留给它自己的进程；
 *   - 超期的通知直接丢弃（那次重启没落成，注入只会说假话）；
 *   - 消费只清 `restartLog`，**不碰 `action`**：action 的消费者是 supervisor。
 */
function takePendingModeNotice(sessionFile: string | undefined): { from: string; to: string } | null {
  try {
    const log = readState().restartLog;
    if (!log || log.notice !== 'mode') return null;
    if (logWrittenAfterStart(log, processStartedAtMs())) return null; // 给下一个进程的，别吃
    if (logTargetsOtherSession(log, sessionFile)) return null; // 别的会话/实例的重启，留给它
    const ts = typeof log.timestamp === 'number' ? log.timestamp : 0;
    if (!ts || Date.now() - ts > MODE_NOTICE_TTL_MS) {
      consumeRestartLog(); // 过期：清掉，免得下次再撞上
      return null;
    }
    const from = typeof log.from === 'string' ? log.from : '';
    const to = typeof log.mode === 'string' ? log.mode : '';
    consumeRestartLog();
    return from && to ? { from, to } : null;
  } catch {
    return null;
  }
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
 *
 * `reason` 只进 `restartLog` 供排查（含内部状态，如"进程原为 full"）；模型侧看到的是
 * `notice:'mode'` + `mode`/`from` 这组结构化字段，由**新模式进程**（takePendingModeNotice）
 * 按模式渲染成适配的文本。autopilot 见到 `notice:'mode'` 不再注入它自己的通用通知。
 *
 * 返回是否真的提交成功：**写盘失败时绝不退出**。否则就是"进程没了、模式也没换、还没有重启"——
 * 与 2026-10-06 那个"通知消费吞掉 action"的故障同一种用户可见症状（静默退出）。
 */
function requestModeRestart(
  ctx: {
    sessionManager?: { getSessionFile?: () => string | undefined };
    shutdown?: () => void;
    ui?: { notify?: (message: string, level?: 'info' | 'warning' | 'error') => void };
  },
  modeName: string,
  from: string,
  reason = `切换模式为 ${modeName}`,
): boolean {
  let written = false;
  try {
    const sessionFile = sessionFileOf(ctx);
    writeRestartRequest('restart', {
      targetSession: sessionFile,
      reason,
      notice: 'mode',
      mode: modeName,
      from,
      // 档位/人设变更不需要"接上工作"：不唤醒模型（见 custom/core/restart-intent.ts）
      intent: 'none',
    });
    written = true;
  } catch {
    /* 写盘失败：下面告警，不退出 */
  }
  if (!written) {
    try {
      ctx.ui?.notify?.(
        `重启请求写盘失败，未退出进程（模式记录已写入，重启后 ${modeName} 才会生效）。` +
          `请手动重启：退出后重新启动，或检查 PI_ADMIN_STATE_FILE 指向的路径。`,
        'error',
      );
    } catch {
      /* 连告警都发不出去就只能留在原进程 */
    }
    return false;
  }
  try {
    ctx.shutdown?.();
  } catch {
    /* 非交互环境无 shutdown */
  }
  return true;
}
