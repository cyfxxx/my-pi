/**
 * Autopilot Feature — admin 工具组
 *
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/tools.ts` 第 73–268 行：
 * autopilot_policy / admin_status / admin_list_models / admin_set_model /
 * admin_get_config / admin_set_config。
 *
 * 分层：
 *   - 格式化与解析函数为纯函数（传入数据、返回文本/结果），可独立测试；
 *   - 文件读写只经 core/config + core/atomic-write + store/ops（均零 Pi 依赖）；
 *   - 与 Pi 的唯一接触点是 adapters/tool-adapter 的 registerTool（故意不 import
 *     vendor 包类型，用 Parameters<typeof registerTool>[0] 推导 ExtensionAPI，
 *     以通过 features 逻辑层隔离校验）。
 */

import path from 'node:path';
import { getAgentDir } from '../../../core/config';
import { writeJSONSync } from '../../../core/atomic-write';
import { registerTool } from '../../../adapters/tool-adapter';
import { readAutopilotConfig, readModels, readSettings, readState, writeRestartRequest } from '../store/ops';
import type { Settings } from '../store/ops';
import type { AutopilotConfig } from '../types';

type PiApi = Parameters<typeof registerTool>[0];

// ── models.json 视图（原 config.ts listAvailableModels 语义）──

export interface AdminModelInfo {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  [k: string]: unknown;
}

export interface AdminProviderInfo {
  name: string;
  baseUrl?: string;
  api?: string;
  models: AdminModelInfo[];
}

/** 读取 models.json，返回带 provider 名的归一化列表（缺文件/损坏 → []） */
export function listProviders(): AdminProviderInfo[] {
  const providers = readModels().providers ?? {};
  return Object.entries(providers).map(([name, p]) => ({
    name,
    baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : undefined,
    api: typeof p.api === 'string' ? p.api : undefined,
    models: Array.isArray(p.models) ? (p.models as unknown as AdminModelInfo[]) : [],
  }));
}

// ── 纯格式化 ──

/** autopilot_policy：策略只读视图 */
export function formatPolicyText(config: AutopilotConfig): string {
  const lines: string[] = [
    '自主运行策略（修改请用 /auto policy）:',
    `  enabled: ${config.enabled}`,
    `  failover 链: ${
      config.fallbackModels.length
        ? config.fallbackModels.map((f) => `${f.provider}/${f.model}`).join(' → ')
        : '(未配置)'
    }`,
    `  failoverAfter: ${config.policy.failoverAfter} 次失败后切换`,
    `  suspendAfter: ${config.policy.suspendAfter} 次失败后暂停任务`,
    `  timeoutFactor: ${config.policy.timeoutFactor}`,
    `  maxIdleMinutes: ${config.maxIdleMinutes}（超时判定挂死并重启）`,
    `  requeueOnRestart: ${config.requeueOnRestart}`,
    `  预算: 日运行上限 ${config.budget.maxRunsPerDay} 次, 日成本上限 $${config.budget.maxCostPerDay}, 模型白名单 ${
      config.budget.allowedModels?.length ? config.budget.allowedModels.join(', ') : '(无)'
    }`,
  ];
  return lines.join('\n');
}

export interface AdminStatusInput {
  settings: Settings;
  providerCount: number;
  sessionFile?: string;
  /** 运行模式（Pi ctx.mode；适配器未暴露时缺省） */
  mode?: string;
  /** 待处理的重启/切换动作（AdminState.action；none/缺省显示「无」） */
  pendingAction?: string;
}

/** admin_status：Agent 运行时状态摘要 */
export function formatAdminStatus(input: AdminStatusInput): string {
  const { settings, providerCount, sessionFile, mode, pendingAction } = input;
  const thinking = settings['defaultThinkingLevel'];
  const sections: string[] = [
    'Agent 状态',
    `  运行模式: ${mode || '未知'}`,
    `  当前 Provider: ${typeof settings.defaultProvider === 'string' && settings.defaultProvider ? settings.defaultProvider : '未设置'}`,
    `  当前模型: ${typeof settings.defaultModel === 'string' && settings.defaultModel ? settings.defaultModel : '未设置'}`,
    `  会话文件: ${sessionFile || '(未知)'}`,
    `  思考层级: ${typeof thinking === 'string' && thinking ? thinking : '未设置'}`,
    `  Provider 总数: ${providerCount}`,
    `  待处理操作: ${pendingAction && pendingAction !== 'none' ? pendingAction : '无'}`,
  ];
  return sections.join('\n');
}

/** admin_list_models：可用模型列表 */
export function formatModelsList(providers: AdminProviderInfo[]): string {
  if (!providers.length) return '(未找到可用模型)';
  const lines: string[] = ['可用模型列表:'];
  for (const p of providers) {
    lines.push(`\n[${p.name}]`);
    if (p.baseUrl) lines.push(`  API: ${p.api || '未知'} | Base URL: ${p.baseUrl}`);
    for (const m of p.models) {
      const ctx = m.contextWindow ? `ctx:${m.contextWindow}` : '';
      const maxT = m.maxTokens ? `max:${m.maxTokens}` : '';
      const reas = m.reasoning ? '思考' : '';
      lines.push(`  - ${m.id}${m.name ? ` (${m.name})` : ''}${[ctx, maxT, reas].filter(Boolean).join(' ')}`);
    }
  }
  return lines.join('\n');
}

// ── settings.json 读写（原 config.ts 的 updateSettings/updateModelConfig 语义）──

/** 敏感字段名（含 key/token/secret/password/auth） */
export function isSensitiveKey(key: string): boolean {
  return /key|token|secret|password|auth/i.test(key.toLowerCase());
}

/** 递归掩蔽含敏感字段名的字符串值（嵌套 provider 配置也掩蔽；深度上限 6） */
export function maskSensitive(val: unknown, depth = 0): unknown {
  if (val === null || typeof val !== 'object' || depth > 6) return val;
  if (Array.isArray(val)) return val.map((v) => maskSensitive(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = isSensitiveKey(k) && typeof v === 'string' ? '***' : maskSensitive(v, depth + 1);
  }
  return out;
}

/** admin_get_config：按 key 读取（敏感字段掩蔽），不传 key 返回全部掩蔽配置 */
export function readConfigField(settings: Settings, key?: string): string {
  if (key) {
    const val = settings[key];
    // 与无参路径一致：递归掩蔽嵌套敏感字段（key=providers 时内层 apiKey 不泄漏）
    const safeVal = isSensitiveKey(key) && typeof val === 'string' ? '***' : maskSensitive(val);
    return `${key}: ${typeof safeVal === 'string' ? safeVal : JSON.stringify(safeVal, null, 2)}`;
  }
  return JSON.stringify(maskSensitive(settings), null, 2);
}

/** admin_set_config 可写白名单（非敏感键；敏感键走 UI 确认流程） */
export function safeConfigKeys(): string[] {
  return [
    'defaultThinkingLevel',
    'steeringMode',
    'followUpMode',
    'packages',
    'hideThinkingBlock',
    'collapseChangelog',
    'theme',
    'defaultProjectTrust',
  ];
}

/** 把工具传入的字符串解析为 settings 值（布尔/整数/小数/JSON 数组或对象，失败保留字符串） */
export function parseConfigValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^\d+\.\d+$/.test(raw)) return parseFloat(raw);
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch {
      /* 保留原字符串 */
    }
  }
  return raw;
}

function settingsPath(): string {
  return path.join(getAgentDir(), 'settings.json');
}

function writeSettings(settings: Settings): boolean {
  try {
    writeJSONSync(settingsPath(), settings);
    return true;
  } catch {
    return false;
  }
}

export interface ApplyResult {
  success: boolean;
  error?: string;
}

/** admin_set_model 的配置写入部分：校验 provider/model 存在后写入 settings.json 默认模型 */
export function applySetModel(provider: string, modelId: string): ApplyResult {
  const models = readModels();
  const providerData = models.providers?.[provider];
  if (!providerData) {
    return { success: false, error: `Provider "${provider}" 不存在` };
  }
  const modelsList = Array.isArray(providerData.models) ? providerData.models : [];
  if (!modelsList.some((m) => m.id === modelId)) {
    return { success: false, error: `模型 "${modelId}" 不在 provider "${provider}" 的模型列表中` };
  }
  const settings = readSettings();
  settings.defaultProvider = provider;
  settings.defaultModel = modelId;
  if (!writeSettings(settings)) {
    return { success: false, error: '写 settings.json 失败' };
  }
  return { success: true };
}

export interface WriteConfigResult {
  success: boolean;
  error?: string;
}

/**
 * admin_set_config 的写入部分：写 settings[key] = value。
 * 非敏感键必须在白名单内；敏感键放行（确认/headless 拒绝由工具层负责）。
 */
export function writeConfigField(key: string, value: unknown): WriteConfigResult {
  if (!isSensitiveKey(key) && !safeConfigKeys().includes(key)) {
    const whitelist = safeConfigKeys();
    return {
      success: false,
      error: `键 "${key}" 不在可写白名单（允许: ${whitelist.join(', ')}；敏感键走确认流程）。`,
    };
  }
  const settings = readSettings();
  settings[key] = value;
  if (!writeSettings(settings)) {
    return { success: false, error: '写 settings.json 失败' };
  }
  return { success: true };
}

// ── 工具注册 ──

export function registerAdminTools(pi: PiApi): void {
  registerTool(pi, {
    name: 'autopilot_policy',
    description: '查看当前 failover 链、失败阈值、挂死检测、预算等自主运行策略配置。策略修改请使用 /auto policy 命令。',
    parameters: {},
    execute: async () => formatPolicyText(readAutopilotConfig()),
  });

  registerTool(pi, {
    name: 'admin_status',
    description:
      '查看当前 Agent 的运行时状态：当前模型/Provider、当前会话文件、运行模式、配置摘要、是否有待处理的重启操作。',
    parameters: {},
    execute: async (_args, ctx) => {
      const settings = readSettings();
      const providerCount = Object.keys(readModels().providers ?? {}).length;
      return formatAdminStatus({
        settings,
        providerCount,
        sessionFile: ctx?.sessionFile,
        pendingAction: readState().action,
      });
    },
  });

  registerTool(pi, {
    name: 'admin_list_models',
    description: '列出 models.json 中所有可用的 Provider 及其模型列表，包含模型 ID、上下文窗口大小等信息。',
    parameters: {},
    execute: async () => formatModelsList(listProviders()),
  });

  registerTool(pi, {
    name: 'admin_set_model',
    description: '切换默认模型和 Provider（更新 settings.json 并重启 Agent，自动恢复当前会话）。',
    parameters: {
      provider: { type: 'string', description: 'Provider 名称，如 "deepseek"' },
      model: { type: 'string', description: '模型 ID' },
    },
    execute: async (args, ctx) => {
      const provider = String(args.provider ?? '').trim();
      const model = String(args.model ?? '').trim();
      if (!provider || !model) return '缺少 provider 或 model。';
      const result = applySetModel(provider, model);
      if (!result.success) return result.error || '设置失败';
      if (!ctx?.hasUI) {
        // headless 禁止未经确认重启宿主（防 agent 自我授权改模型并重启）
        return '无 UI 环境禁止直接切换模型（会重启 Agent）。请在 TUI 会话中执行，或设置环境变量 PI_AUTOPILOT_ALLOW_HEADLESS=1 显式放行。';
      }
      const confirmed = await ctx.confirm?.('切换模型', `将切换为 ${provider}/${model}，需要重启 Agent。是否继续？`);
      if (!confirmed) return `已保存配置但未重启。下次启动将使用 ${provider}/${model}`;
      writeRestartRequest('set_model', {
        targetSession: ctx.sessionFile,
        targetProvider: provider,
        targetModel: model,
        reason: `切换模型为 ${provider}/${model}`,
      });
      ctx.shutdown?.();
      return `正在重启以加载模型 ${provider}/${model}...`;
    },
  });

  registerTool(pi, {
    name: 'admin_get_config',
    description: '读取 settings.json 的配置项。不传 key 时返回全部配置（敏感字段掩蔽为 ***）。',
    parameters: {
      key: { type: 'string', description: '配置键名（可选），不传则返回全部', optional: true },
    },
    execute: async (args) => {
      const key = typeof args.key === 'string' && args.key.trim() ? args.key.trim() : undefined;
      return readConfigField(readSettings(), key);
    },
  });

  registerTool(pi, {
    name: 'admin_set_config',
    description: '修改 settings.json 中的配置项。敏感字段（如含 key/token/secret 的字段）需用户确认。修改立即生效。',
    parameters: {
      key: { type: 'string', description: '配置键名' },
      value: { type: 'string', description: '配置值（字符串）。数组或对象字段会自动解析 JSON。' },
    },
    execute: async (args, ctx) => {
      const key = String(args.key ?? '').trim();
      if (!key) return '缺少 key。';
      const parsedValue = parseConfigValue(String(args.value ?? ''));
      if (isSensitiveKey(key)) {
        if (ctx?.hasUI) {
          const ok = await ctx.confirm?.('修改敏感配置', `确认修改 "${key}" 为 ${JSON.stringify(parsedValue)}？`);
          if (!ok) return '已取消';
        } else {
          // headless 下无 UI 确认，敏感 key（含 key/token/secret）硬拒绝（防无人值守误改凭据）
          return `headless 模式拒绝修改敏感配置 "${key}"（无确认通道，请在 TUI 会话中操作）`;
        }
      } else if (!safeConfigKeys().includes(key)) {
        // 非敏感键也只允许显式白名单，防止绕过 admin_set_model 的重启守卫
        const whitelist = safeConfigKeys();
        return `键 "${key}" 不在可写白名单（允许: ${whitelist.join(', ')}；敏感键走确认流程）。`;
      }
      const result = writeConfigField(key, parsedValue);
      if (!result.success) return result.error || '写入失败';
      return `已更新配置: ${key} = ${JSON.stringify(parsedValue)}`;
    },
  });
}
