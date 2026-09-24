/**
 * autopilot admin 工具组测试
 *
 * 覆盖：格式化函数（纯逻辑）、settings.json 读写（applySetModel / writeConfigField /
 * readConfigField）、工具注册与执行流程（admin_set_model 的 headless/确认分支、
 * admin_set_config 的白名单/敏感键分支）。
 *
 * 隔离：PI_CODING_AGENT_DIR 指向 mkdtemp 目录（getAgentDir 每次读 env，无模块级缓存），
 * PI_ADMIN_STATE_FILE 指向同一目录下的 state.json。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTool } from '../../../adapters/tool-adapter';
import { defaultAutopilotConfig } from '../types';
import {
  applySetModel,
  formatAdminStatus,
  formatModelsList,
  formatPolicyText,
  isSensitiveKey,
  listProviders,
  maskSensitive,
  parseConfigValue,
  readConfigField,
  registerAdminTools,
  safeConfigKeys,
  writeConfigField,
} from '../tools/admin-tools';

let agentDir: string;
let statePath: string;
const origAgent = process.env.PI_CODING_AGENT_DIR;
const origState = process.env.PI_ADMIN_STATE_FILE;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), 'my-pi-admin-tools-'));
  statePath = join(agentDir, 'state.json');
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_ADMIN_STATE_FILE = statePath;
});

afterEach(() => {
  if (origAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = origAgent;
  if (origState === undefined) delete process.env.PI_ADMIN_STATE_FILE;
  else process.env.PI_ADMIN_STATE_FILE = origState;
  rmSync(agentDir, { recursive: true, force: true });
});

function writeSettingsFile(obj: unknown): void {
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify(obj));
}

function writeModelsFile(obj: unknown): void {
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify(obj));
}

function readSettingsFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf-8')) as Record<string, unknown>;
}

function readStateFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
}

// ── 工具注册与执行辅助 ──

interface RegisteredTool {
  name: string;
  parameters: { properties?: Record<string, unknown> };
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: unknown,
    onUpdate?: unknown,
    piCtx?: unknown,
  ) => Promise<{ content: { type: string; text?: string }[] }>;
}

function collectTools(): { tools: RegisteredTool[]; pi: Parameters<typeof registerTool>[0] } {
  const tools: RegisteredTool[] = [];
  const pi = {
    registerTool: (def: unknown) => {
      tools.push(def as RegisteredTool);
    },
  } as unknown as Parameters<typeof registerTool>[0];
  return { tools, pi };
}

async function runTool(
  tools: RegisteredTool[],
  name: string,
  params: Record<string, unknown> = {},
  piCtx: Record<string, unknown> = {},
): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  const res = await tool.execute('call-1', params, undefined, undefined, piCtx);
  return res.content[0]?.text ?? '';
}

// ── 纯格式化 ──

describe('formatPolicyText', () => {
  it('默认配置输出完整策略行', () => {
    const text = formatPolicyText(defaultAutopilotConfig());
    expect(text).toContain('自主运行策略（修改请用 /auto policy）:');
    expect(text).toContain('enabled: true');
    expect(text).toContain('failover 链: (未配置)');
    expect(text).toContain('failoverAfter: 2 次失败后切换');
    expect(text).toContain('suspendAfter: 5 次失败后暂停任务');
    expect(text).toContain('预算: 日运行上限 50 次');
    expect(text).toContain('模型白名单 (无)');
  });

  it('自定义 failover 链与预算原样展示', () => {
    const cfg = defaultAutopilotConfig();
    cfg.fallbackModels = [
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'openai', model: 'gpt-x' },
    ];
    cfg.budget = { maxRunsPerDay: 5, maxCostPerDay: 1.5, allowedModels: ['deepseek-chat', 'gpt-x'] };
    const text = formatPolicyText(cfg);
    expect(text).toContain('deepseek/deepseek-chat → openai/gpt-x');
    expect(text).toContain('日成本上限 $1.5');
    expect(text).toContain('模型白名单 deepseek-chat, gpt-x');
  });
});

describe('formatAdminStatus', () => {
  it('完整字段输出', () => {
    const text = formatAdminStatus({
      settings: { defaultProvider: 'deepseek', defaultModel: 'deepseek-chat', defaultThinkingLevel: 'high' },
      providerCount: 3,
      sessionFile: '/tmp/s.jsonl',
      mode: 'tui',
      pendingAction: 'set_model',
    });
    expect(text).toContain('运行模式: tui');
    expect(text).toContain('当前 Provider: deepseek');
    expect(text).toContain('当前模型: deepseek-chat');
    expect(text).toContain('会话文件: /tmp/s.jsonl');
    expect(text).toContain('思考层级: high');
    expect(text).toContain('Provider 总数: 3');
    expect(text).toContain('待处理操作: set_model');
  });

  it('缺省字段回退占位', () => {
    const text = formatAdminStatus({ settings: {}, providerCount: 0 });
    expect(text).toContain('运行模式: 未知');
    expect(text).toContain('当前 Provider: 未设置');
    expect(text).toContain('当前模型: 未设置');
    expect(text).toContain('会话文件: (未知)');
    expect(text).toContain('思考层级: 未设置');
    expect(text).toContain('待处理操作: 无');
  });
});

describe('formatModelsList', () => {
  it('空列表给出提示', () => {
    expect(formatModelsList([])).toBe('(未找到可用模型)');
  });

  it('输出 provider 元信息与模型细节', () => {
    const text = formatModelsList([
      {
        name: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        api: 'openai-completions',
        models: [{ id: 'deepseek-chat', name: 'Chat', contextWindow: 64000, maxTokens: 8000, reasoning: true }],
      },
      { name: 'local', models: [{ id: 'm1' }] },
    ]);
    expect(text).toContain('[deepseek]');
    expect(text).toContain('API: openai-completions | Base URL: https://api.deepseek.com');
    expect(text).toContain('- deepseek-chat (Chat)ctx:64000 max:8000 思考');
    expect(text).toContain('[local]');
    expect(text).toContain('- m1');
  });
});

// ── models.json 读取 ──

describe('listProviders', () => {
  it('归一化 provider 名并保留模型列表', () => {
    writeModelsFile({
      providers: {
        deepseek: { baseUrl: 'https://api.deepseek.com', api: 'openai-completions', models: [{ id: 'a' }] },
        local: { models: [{ id: 'b' }] },
      },
    });
    const providers = listProviders();
    expect(providers.map((p) => p.name)).toEqual(['deepseek', 'local']);
    expect(providers[0].baseUrl).toBe('https://api.deepseek.com');
    expect(providers[0].models).toHaveLength(1);
    expect(providers[1].baseUrl).toBeUndefined();
  });

  it('文件缺失 → 空列表', () => {
    expect(listProviders()).toEqual([]);
  });
});

// ── settings.json 读写 ──

describe('applySetModel', () => {
  beforeEach(() => {
    writeModelsFile({ providers: { deepseek: { models: [{ id: 'deepseek-chat' }] } } });
    writeSettingsFile({ defaultProvider: 'old', defaultModel: 'old-m', theme: 'dark' });
  });

  it('成功写入默认模型并保留其他配置', () => {
    expect(applySetModel('deepseek', 'deepseek-chat')).toEqual({ success: true });
    expect(readSettingsFile()).toEqual({
      defaultProvider: 'deepseek',
      defaultModel: 'deepseek-chat',
      theme: 'dark',
    });
  });

  it('未知 provider / 模型报错且不改文件', () => {
    expect(applySetModel('nope', 'x')).toEqual({ success: false, error: 'Provider "nope" 不存在' });
    expect(applySetModel('deepseek', 'nope')).toEqual({
      success: false,
      error: '模型 "nope" 不在 provider "deepseek" 的模型列表中',
    });
    expect(readSettingsFile().defaultModel).toBe('old-m');
  });
});

describe('readConfigField', () => {
  const settings = {
    defaultModel: 'm',
    apiKey: 'sk-secret',
    providers: { p: { apiKey: 'nested-secret', baseUrl: 'https://x' } },
  };

  it('普通键原样、敏感字符串键掩蔽', () => {
    expect(readConfigField(settings, 'defaultModel')).toBe('defaultModel: m');
    expect(readConfigField(settings, 'apiKey')).toBe('apiKey: ***');
  });

  it('对象键递归掩蔽嵌套敏感字段', () => {
    const text = readConfigField(settings, 'providers');
    expect(text).toContain('"apiKey": "***"');
    expect(text).not.toContain('nested-secret');
  });

  it('不传 key 返回全部掩蔽配置', () => {
    const text = readConfigField(settings);
    expect(text).toContain('"apiKey": "***"');
    expect(text).not.toContain('sk-secret');
    expect(text).not.toContain('nested-secret');
  });

  it('maskSensitive 处理数组与深度上限', () => {
    expect(maskSensitive([{ token: 'abc' }, 'plain'])).toEqual([{ token: '***' }, 'plain']);
    expect(maskSensitive({ a: { b: { c: { d: { e: { f: { g: { token: 'deep' } } } } } } } })).toEqual({
      a: { b: { c: { d: { e: { f: { g: { token: 'deep' } } } } } } },
    });
  });
});

describe('writeConfigField', () => {
  beforeEach(() => {
    writeSettingsFile({ theme: 'light', other: 1 });
  });

  it('白名单外键拒绝且不改文件', () => {
    const r = writeConfigField('other', 2);
    expect(r.success).toBe(false);
    expect(r.error).toContain('不在可写白名单');
    expect(readSettingsFile()).toEqual({ theme: 'light', other: 1 });
  });

  it('白名单键写入成功', () => {
    expect(writeConfigField('theme', 'dark')).toEqual({ success: true });
    expect(readSettingsFile().theme).toBe('dark');
  });

  it('敏感键放行（确认流程由工具层负责）', () => {
    expect(writeConfigField('apiKey', 'sk-1')).toEqual({ success: true });
    expect(readSettingsFile().apiKey).toBe('sk-1');
  });
});

describe('parseConfigValue / isSensitiveKey / safeConfigKeys', () => {
  it('解析布尔、整数、小数、JSON 与普通字符串', () => {
    expect(parseConfigValue('true')).toBe(true);
    expect(parseConfigValue('false')).toBe(false);
    expect(parseConfigValue('42')).toBe(42);
    expect(parseConfigValue('1.5')).toBe(1.5);
    expect(parseConfigValue('[1,2]')).toEqual([1, 2]);
    expect(parseConfigValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseConfigValue('dark')).toBe('dark');
    expect(parseConfigValue('{"bad')).toBe('{"bad');
  });

  it('敏感键判定', () => {
    expect(isSensitiveKey('apiKey')).toBe(true);
    expect(isSensitiveKey('AUTH_TOKEN')).toBe(true);
    expect(isSensitiveKey('theme')).toBe(false);
  });

  it('白名单含 admin_set_config 允许的键', () => {
    expect(safeConfigKeys()).toContain('theme');
    expect(safeConfigKeys()).toContain('defaultThinkingLevel');
    expect(safeConfigKeys()).not.toContain('defaultModel');
  });
});

// ── 注册与执行流程 ──

describe('registerAdminTools', () => {
  it('注册 6 个工具且参数形状正确', () => {
    const { tools, pi } = collectTools();
    registerAdminTools(pi);
    expect(tools.map((t) => t.name)).toEqual([
      'autopilot_policy',
      'admin_status',
      'admin_list_models',
      'admin_set_model',
      'admin_get_config',
      'admin_set_config',
    ]);
    const setModel = tools.find((t) => t.name === 'admin_set_model');
    expect(Object.keys(setModel?.parameters.properties ?? {})).toEqual(['provider', 'model']);
    const setConfig = tools.find((t) => t.name === 'admin_set_config');
    expect(Object.keys(setConfig?.parameters.properties ?? {})).toEqual(['key', 'value']);
  });

  it('admin_get_config 递归掩蔽敏感字段', async () => {
    writeSettingsFile({ defaultModel: 'm', providers: { p: { apiKey: 'secret' } } });
    const { tools, pi } = collectTools();
    registerAdminTools(pi);
    const whole = await runTool(tools, 'admin_get_config');
    expect(whole).toContain('"apiKey": "***"');
    expect(whole).not.toContain('secret');
    const scoped = await runTool(tools, 'admin_get_config', { key: 'providers' });
    expect(scoped).toContain('"apiKey": "***"');
  });

  it('admin_set_config：白名单外拒绝、白名单写入、敏感键 headless 拒绝', async () => {
    writeSettingsFile({ theme: 'light' });
    const { tools, pi } = collectTools();
    registerAdminTools(pi);

    const denied = await runTool(tools, 'admin_set_config', { key: 'other', value: '2' });
    expect(denied).toContain('不在可写白名单');
    expect(readSettingsFile()).toEqual({ theme: 'light' });

    const ok = await runTool(tools, 'admin_set_config', { key: 'theme', value: 'dark' });
    expect(ok).toBe('已更新配置: theme = "dark"');
    expect(readSettingsFile().theme).toBe('dark');

    const headless = await runTool(tools, 'admin_set_config', { key: 'apiKey', value: 'sk-1' });
    expect(headless).toContain('headless 模式拒绝修改敏感配置');
    expect(readSettingsFile().apiKey).toBeUndefined();

    const cancelled = await runTool(
      tools,
      'admin_set_config',
      { key: 'apiKey', value: 'sk-1' },
      { hasUI: true, ui: { confirm: async () => false } },
    );
    expect(cancelled).toBe('已取消');

    const confirmed = await runTool(
      tools,
      'admin_set_config',
      { key: 'apiKey', value: 'sk-1' },
      { hasUI: true, ui: { confirm: async () => true } },
    );
    expect(confirmed).toBe('已更新配置: apiKey = "sk-1"');
    expect(readSettingsFile().apiKey).toBe('sk-1');
  });

  it('admin_set_model：未知 provider 报错、headless 保存不重启、UI 确认后写 state 并 shutdown', async () => {
    writeModelsFile({ providers: { deepseek: { models: [{ id: 'deepseek-chat' }] } } });
    writeSettingsFile({ defaultProvider: 'old', defaultModel: 'old-m' });
    const { tools, pi } = collectTools();
    registerAdminTools(pi);

    const unknown = await runTool(tools, 'admin_set_model', { provider: 'nope', model: 'x' });
    expect(unknown).toBe('Provider "nope" 不存在');

    const headless = await runTool(tools, 'admin_set_model', { provider: 'deepseek', model: 'deepseek-chat' });
    expect(headless).toContain('无 UI 环境禁止直接切换模型');
    expect(readSettingsFile().defaultModel).toBe('deepseek-chat');

    const cancelled = await runTool(
      tools,
      'admin_set_model',
      { provider: 'deepseek', model: 'deepseek-chat' },
      { hasUI: true, ui: { confirm: async () => false } },
    );
    expect(cancelled).toContain('已保存配置但未重启');

    let shutdownCalled = false;
    const confirmed = await runTool(
      tools,
      'admin_set_model',
      { provider: 'deepseek', model: 'deepseek-chat' },
      {
        hasUI: true,
        sessionManager: { getSessionFile: () => '/tmp/sess.jsonl' },
        ui: { confirm: async () => true },
        shutdown: () => {
          shutdownCalled = true;
        },
      },
    );
    expect(confirmed).toContain('正在重启以加载模型 deepseek/deepseek-chat');
    expect(shutdownCalled).toBe(true);
    const state = readStateFile();
    expect(state.action).toBe('set_model');
    expect(state.targetProvider).toBe('deepseek');
    expect(state.targetModel).toBe('deepseek-chat');
    expect(state.targetSession).toBe('/tmp/sess.jsonl');
  });

  it('admin_status 汇总设置、模型数与待处理动作', async () => {
    writeSettingsFile({ defaultProvider: 'deepseek', defaultModel: 'm', defaultThinkingLevel: 'low' });
    writeModelsFile({ providers: { a: { models: [] }, b: { models: [] } } });
    const { tools, pi } = collectTools();
    registerAdminTools(pi);
    const text = await runTool(tools, 'admin_status');
    expect(text).toContain('当前 Provider: deepseek');
    expect(text).toContain('Provider 总数: 2');
    expect(text).toContain('思考层级: low');
    expect(text).toContain('待处理操作: 无');
  });

  it('autopilot_policy / admin_list_models 走真实读取路径', async () => {
    writeModelsFile({ providers: { deepseek: { models: [{ id: 'deepseek-chat' }] } } });
    const { tools, pi } = collectTools();
    registerAdminTools(pi);
    expect(await runTool(tools, 'autopilot_policy')).toContain('自主运行策略');
    const models = await runTool(tools, 'admin_list_models');
    expect(models).toContain('[deepseek]');
    expect(models).toContain('- deepseek-chat');
  });
});
