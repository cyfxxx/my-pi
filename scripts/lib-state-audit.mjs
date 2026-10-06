#!/usr/bin/env node
/**
 * lib-state-audit.mjs — 运行时状态不变量（"使用层面静默失效"的体检）
 *
 * 为什么需要单独一类检查：`tsc` / `vitest` / golden 判的是"**实现**对不对"，而用户实际撞到的
 * 是"**配置与运行时状态之间的不一致被静默吞掉**"——人设文件没了（启动器静默不注入）、功能名
 * 拼错（该功能静默不注册）、会话记录指向不存在的会话文件（模式静默回 default）、重启请求写了
 * 没落地、重启通知没被消费、环境变量把按会话的模式硬覆盖掉……这些不会让任何门禁变红，只会让
 * 行为悄悄退化，且**只有真的去用才发现**。
 *
 * 本库只做"读 + 判"：确定性、零 LLM、零网络、**绝不写任何文件**（守门脚本改状态是最坏的设计）。
 *
 * 数据源（职责见 custom/features/mode/logic.ts）：
 *   portable/agent/modes.json               模式定义（default + 自定义模式）
 *   portable/agent/modes-sessions.json      会话文件路径 → 模式记录（gitignored）
 *   portable/agent/mode-restart-guard.json  自愈重启防环标记（gitignored）
 *   portable/agent/autopilot/state.json     重启请求 / 待注入通知（gitignored）
 *   环境变量                                 PI_AGENT_MODE(+_SOURCE)
 *
 * 用法（库）：
 *   const snap = buildSnapshot({ agentDir, knownFeatures });
 *   for (const f of auditState(snap)) ...
 * 用法（CLI）：node scripts/state-audit.mjs [--json] [--strict]
 *
 * 与 supervisor 实时检测的分工：**"重启请求被谁吞掉"这类"进程已经退出"的异常，offline
 * 体检看不见**（它只能看到最终落盘的状态）——那类由 scripts/pi-supervisor.sh 在退出点检测
 * （见 rounds.jsonl 的 lost_restart）。本库负责"状态本身自相矛盾/指向不存在的东西"。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 代码内固定的模式（与 custom/features/mode/logic.ts 的 FIXED_MODES、lib-mode.sh 的 FIXED 一致；漂移由 test-state-audit.mjs 交叉校验） */
export const FIXED_MODES = ['full', 'minimal'];
/** 会触发重启的 admin action（与 pi-supervisor.sh 的 read_admin_action 白名单一致） */
export const RESTART_ACTIONS = ['restart', 'restart_hang', 'switch_session', 'set_model'];
/** supervisor 只认这个窗口内的重启请求（镜像 pi-supervisor.sh 的 `fresh` 判据） */
export const ADMIN_STATE_FRESH_MS = 300_000;
/** 模式切换通知的有效期（镜像 custom/features/mode/logic.ts 的 MODE_NOTICE_TTL_MS） */
export const MODE_NOTICE_TTL_MS = 600_000;
/** 自愈重启防环窗口（镜像 logic.ts 的 MODE_RESTART_GUARD_MS） */
export const RESTART_GUARD_MS = 120_000;
/** 会话模式记录的保留期（镜像 logic.ts 的 SESSION_MODE_RETENTION_MS） */
export const SESSION_MODE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** 时钟回拨判据：guard / 记录时间戳领先这么多就认为是异常 */
const CLOCK_SKEW_MS = 120_000;

const LEVEL_ORDER = { error: 0, warning: 1, info: 2 };

function readOf(path) {
  try {
    return { present: true, raw: readFileSync(path, 'utf-8') };
  } catch (err) {
    return { present: false, raw: null, error: String(err?.code ?? err) };
  }
}

function parseOf(entry) {
  if (!entry || !entry.present || entry.raw === null) return { ok: false, value: null, reason: entry?.error || 'missing' };
  try {
    return { ok: true, value: JSON.parse(entry.raw), reason: null };
  } catch (err) {
    return { ok: false, value: null, reason: `JSON 解析失败: ${err?.message ?? err}` };
  }
}

/**
 * 组装快照（唯一碰文件系统的地方；纯函数 auditState 只吃快照，测试才能造任意状态）。
 *
 * `knownFeatures` 由调用方给（CLI 取 scripts/registration-baseline.json 的键 = 从代码生成的
 * 功能名真值），本库不硬编码功能清单——那正是"双份真值"的老毛病。
 */
export function buildSnapshot({ agentDir, knownFeatures = [], now = Date.now(), env = process.env, exists = existsSync }) {
  return {
    agentDir,
    now,
    knownFeatures,
    exists,
    env: {
      PI_AGENT_MODE: env.PI_AGENT_MODE,
      PI_AGENT_MODE_SOURCE: env.PI_AGENT_MODE_SOURCE,
    },
    files: {
      modes: readOf(join(agentDir, 'modes.json')),
      sessions: readOf(join(agentDir, 'modes-sessions.json')),
      guard: readOf(join(agentDir, 'mode-restart-guard.json')),
      admin: readOf(join(agentDir, 'autopilot', 'state.json')),
      legacyState: readOf(join(agentDir, 'modes-state.json')),
    },
  };
}

/**
 * 判定全部不变量。返回 findings（按严重度排序）：
 *   { code, level: 'error'|'warning'|'info', message, fix? }
 *
 * 严重度口径：`error` = 用户能感觉到行为退化但门禁看不出来（daily-health 据此 alert）；
 * `warning` = 可能是有意为之或暂时状态（记录，不打扰）；`info` = 只解释现状。
 */
export function auditState(snap) {
  const out = [];
  const add = (level, code, message, fix) => out.push({ code, level, message, ...(fix ? { fix } : {}) });
  const { now, knownFeatures, env, files } = snap;

  // ── modes.json：模式定义 ──
  const modes = parseOf(files.modes);
  if (!files.modes.present) {
    add('error', 'modes-missing', 'modes.json 缺失：自定义模式与 default 全部回落到 full（新会话都会按 full 启动）', '检查 sync/ 备份或 `git checkout portable/agent/modes.json`');
  } else if (!modes.ok) {
    add('error', 'modes-corrupt', `modes.json 无法解析（${modes.reason}）：所有自定义模式静默消失，会话模式全部回落到 full`, '人工修复 JSON（勿让脚本覆盖，配置是入库文件）');
  }
  const modesObj = (modes.ok && modes.value && typeof modes.value === 'object' ? modes.value : {}) || {};
  const customModes = modesObj.modes && typeof modesObj.modes === 'object' ? modesObj.modes : {};
  const knownModes = [...FIXED_MODES, ...Object.keys(customModes)];

  if (modes.ok) {
    const def = modesObj.default;
    if (typeof def !== 'string' || !knownModes.includes(def)) {
      add('error', 'modes-default-unknown', `modes.json 的 default=${JSON.stringify(def)} 不是已知模式：新会话会静默按 full 启动`, `把 default 改成 ${knownModes.join('/')} 之一`);
    }
    if ('current' in modesObj) {
      add('info', 'modes-legacy-current', `modes.json 里还留着 current=${JSON.stringify(modesObj.current)}：这是 2026-10-05 之前的全局选择字段，已不再生效（模式按会话记录）`, '可删除该字段（留着无害）');
    }
    for (const [name, cfg] of Object.entries(customModes)) {
      const c = cfg && typeof cfg === 'object' ? cfg : {};
      for (const f of Array.isArray(c.features) ? c.features : []) {
        if (f !== '*' && knownFeatures.length > 0 && !knownFeatures.includes(f)) {
          add('error', 'mode-feature-unknown', `模式 ${name} 的功能名 "${f}" 不存在：该功能不会被注册（拼错会静默少功能，模式看起来"没生效"）`, `改成 ${knownFeatures.slice(0, 4).join('/')}… 之一，或删掉该条`);
        }
      }
      if (typeof c.appendPrompt === 'string' && c.appendPrompt) {
        const abs = join(snap.agentDir, c.appendPrompt);
        if (!snap.exists(abs)) {
          add('error', 'mode-persona-missing', `模式 ${name} 的人设文件 ${c.appendPrompt} 不存在：启动器会**静默不注入人设**（进程仍是该模式，但人设没了）`, `补回该文件，或把 modes.json 里的 appendPrompt 指向存在的文件`);
        }
      }
    }
  }

  // ── modes-sessions.json：会话 → 模式记录 ──
  const sessions = parseOf(files.sessions);
  if (files.sessions.present && !sessions.ok) {
    add('warning', 'sessions-corrupt', `modes-sessions.json 无法解析（${sessions.reason}）：全部会话的模式记录丢失，都会回落 default`, '删除该文件即可重建（记录可重造，不入库）');
  }
  if (sessions.ok && sessions.value && typeof sessions.value === 'object') {
    for (const [file, rec] of Object.entries(sessions.value)) {
      const r = rec && typeof rec === 'object' ? rec : {};
      if (typeof r.mode !== 'string' || !r.mode) continue;
      if (!knownModes.includes(r.mode)) {
        add('warning', 'session-mode-unknown', `会话模式记录里 ${r.mode} 已不是已知模式（${file}）：该会话静默回落 default`, `在会话里重跑 /mode <模式名>`);
      }
      if (!snap.exists(file)) {
        const ts = Date.parse(typeof r.updatedAt === 'string' ? r.updatedAt : '');
        const age = Number.isFinite(ts) ? now - ts : null;
        if (age !== null && age <= SESSION_MODE_RETENTION_MS) {
          add('warning', 'session-file-missing', `会话模式记录指向不存在的会话文件：${file}（会话被移动/改名/删除了？）→ 该会话下次打开会静默用 default`, '把会话文件放回原路径，或删掉这条记录后重新 /mode');
        } else {
          add('info', 'session-record-orphan', `孤儿会话模式记录（文件已不存在且超保留期，下次写入时会被裁掉）：${file}`);
        }
      } else {
        const ts = Date.parse(typeof r.updatedAt === 'string' ? r.updatedAt : '');
        if (Number.isFinite(ts) && ts - now > CLOCK_SKEW_MS) {
          add('warning', 'session-record-clock-skew', `会话模式记录的 updatedAt 在未来（${r.updatedAt}）：本机时钟回拨过？`, '忽略即可，下次写入会覆盖');
        }
      }
    }
  }

  // ── mode-restart-guard.json：自愈重启防环标记 ──
  const guard = parseOf(files.guard);
  if (files.guard.present && !guard.ok) {
    add('warning', 'guard-unreadable', `mode-restart-guard.json 无法解析（${guard.reason}）：自愈重启的防环标记失效，可能重复重启一次`, '删除该文件即可重建');
  } else if (guard.ok && guard.value && typeof guard.value === 'object') {
    const ts = typeof guard.value.ts === 'number' ? guard.value.ts : 0;
    if (ts - now > CLOCK_SKEW_MS) {
      add('warning', 'guard-clock-skew', `防环标记的时间戳在未来（${new Date(ts).toISOString()}）：本机时钟回拨过？`, '删除 mode-restart-guard.json 即可重建');
    } else if (ts > 0 && now - ts <= RESTART_GUARD_MS) {
      add('info', 'guard-recent', `刚刚触发过模式自愈重启（${Math.round((now - ts) / 1000)}s 前，键=${String(guard.value.key ?? '?')}）：若不是刚切过模式，请查会话模式记录`);
    }
  }

  // ── state.json：重启请求 / 待注入通知 ──
  const admin = parseOf(files.admin);
  if (files.admin.present && !admin.ok) {
    add('warning', 'admin-state-unreadable', `autopilot/state.json 无法解析（${admin.reason}）：重启/切会话请求会被 supervisor 忽略`, '删除该文件即可重建（内容都是瞬时请求）');
  } else if (admin.ok && admin.value && typeof admin.value === 'object') {
    const action = admin.value.action;
    const ts = typeof admin.value.timestamp === 'number' ? admin.value.timestamp : 0;
    if (RESTART_ACTIONS.includes(action)) {
      if (!ts) {
        add('warning', 'restart-request-undated', `state.json 有未执行的 ${action} 请求但没有时间戳：supervisor 会当作过期忽略`, '重启一次 my-pi 使状态归一');
      } else if (now - ts > ADMIN_STATE_FRESH_MS) {
        const mins = Math.round((now - ts) / 60000);
        add('warning', 'restart-request-stale', `state.json 里挂着 ${mins} 分钟前未执行的 ${action} 请求（supervisor 只认 ${ADMIN_STATE_FRESH_MS / 1000}s 内的窗口，会直接忽略它）：那次切换/重启**没有落地**`, '重启一次 my-pi；若是 /mode 触发的，重启后确认模式已生效');
      }
    }
    const log = admin.value.restartLog;
    if (log && typeof log === 'object' && log.intent !== undefined && !['continue', 'none', 'auto'].includes(log.intent)) {
      add('warning', 'restart-intent-invalid', `重启日志的 intent=${JSON.stringify(log.intent)} 无法识别：会按 auto 处理（由会话盘面判断是否继续执行任务）`, '删掉 state.json 里的 restartLog 即可（瞬时状态）');
    }
    if (log && typeof log === 'object') {
      const lts = typeof log.timestamp === 'number' ? log.timestamp : 0;
      if (lts > 0 && now - lts > MODE_NOTICE_TTL_MS) {
        const mins = Math.round((now - lts) / 60000);
        add('warning', 'notice-undelivered', `一条重启通知（action=${String(log.action ?? '?')}${log.notice ? `, notice=${String(log.notice)}` : ''}）${mins} 分钟未被消费：新模式进程没有把它注入（会话与会话文件对不上？或那次重启没发生）`, `看 portable/agent/recovery/rounds.jsonl 的对应轮次；必要时删除 state.json 里的 restartLog`);
      }
    }
  }

  // ── 环境变量：硬覆盖会把"按会话"整条链跳过 ──
  const envMode = env.PI_AGENT_MODE;
  const envSource = env.PI_AGENT_MODE_SOURCE;
  if (envMode && (envSource === undefined || envSource === 'env')) {
    add('warning', 'env-hard-override', `当前环境里有 PI_AGENT_MODE=${envMode}（硬覆盖）：所有会话都会按它启动，按会话记录的模式与你看到的 default 都会被跳过`, `unset PI_AGENT_MODE（这是给测试/临时用的开关）`);
  }

  if (files.legacyState.present) {
    add('info', 'legacy-state-file', 'portable/agent/modes-state.json 还在（上一版的全局 current，已不读取）', '可删除（gitignored）');
  }

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.code.localeCompare(b.code));
}

/** 汇总：计数 + 是否达到 alert（error 级） */
export function summarize(findings) {
  const byLevel = { error: 0, warning: 0, info: 0 };
  for (const f of findings) byLevel[f.level] = (byLevel[f.level] ?? 0) + 1;
  return { total: findings.length, ...byLevel, alert: byLevel.error > 0 };
}
