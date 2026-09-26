/**
 * Bootstrap — my-pi 的唯一扩展入口
 *
 * pi 的扩展约定：模块必须**默认导出**一个工厂函数 `(pi) => void | Promise<void>`，
 * pi 加载扩展时调用它（见 vendor/pi loader.ts 的 `jiti.import(path, { default: true })`）。
 *
 * 职责：只做组装——解析启动模式（写 `PI_AGENT_MODE`/`PI_MEMORY_NAMESPACE` 环境变量、按模式过滤功能），
 * 并把 FEATURES 交给 registry 注册到 pi。
 * 约束：
 *   - 会话、配置目录、模型等由 pi 自身管理，扩展不创建 session
 *   - 每个功能的注册都通过 registry；此处不直接调用 feature 内部实现
 *   - Pi API 只经 custom/adapters/ 接触（本文件仅用 import type）
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { defineFeature, registerAll } from './core/registry';
import { resolveEffectiveMode, getEffectiveModeConfig, isFeatureEnabled } from './features/mode/logic';
import { register as registerWebSearch } from './features/web-search';
import { register as registerContext } from './features/context';
import { register as registerLink } from './features/link';
import { register as registerMemory } from './features/memory';
import { register as registerMode } from './features/mode';
import { register as registerPlanMode } from './features/plan-mode';
import { register as registerIntervention } from './features/intervention';
import { register as registerSubagent } from './features/subagent';
import { register as registerTmux } from './features/tmux';
import { register as registerBrowser } from './features/browser';
import { register as registerVoice } from './features/voice';
import { register as registerAutopilot } from './features/autopilot';

// 功能清单：每迁移一个功能，就在这里添加一行
const FEATURES = [
  defineFeature('web-search', registerWebSearch),
  defineFeature('context', registerContext),
  defineFeature('link', registerLink),
  defineFeature('memory', registerMemory),
  defineFeature('mode', registerMode),
  defineFeature('plan-mode', registerPlanMode),
  defineFeature('intervention', registerIntervention),
  defineFeature('subagent', registerSubagent),
  defineFeature('tmux', registerTmux),
  defineFeature('browser', registerBrowser),
  defineFeature('voice', registerVoice),
  defineFeature('autopilot', registerAutopilot),
];

export default function bootstrap(pi: ExtensionAPI): void {
  // 模式 = 启动档位：据此过滤注册的功能，并注入记忆命名空间。
  const mode = resolveEffectiveMode();
  const config = getEffectiveModeConfig();
  if (!process.env.PI_AGENT_MODE) process.env.PI_AGENT_MODE = mode;
  if (config.memoryNamespace && !process.env.PI_MEMORY_NAMESPACE) {
    process.env.PI_MEMORY_NAMESPACE = config.memoryNamespace;
  }
  // mode 功能始终注册（否则极简模式下无法切回）
  const enabled = FEATURES.filter((f) => f.name === 'mode' || isFeatureEnabled(f.name, config));
  registerAll(pi, enabled);
}
