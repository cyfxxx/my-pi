/**
 * Bootstrap
 * 
 * 职责：组装所有功能，创建 Session
 * 约束：
 *   - 这是唯一的入口
 *   - 每个功能的注册都通过 registry
 */

import { createSession } from './adapters/agent-adapter';
import * as config from './core/config';
import { defineFeature, registerAll } from './core/registry';
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

export async function bootstrap() {
  config.ensureDirectories();

  const session = await createSession({
    configDir: config.getConfigDir(),
    sessionDir: config.getSessionDir(),
    extensionDir: config.getExtensionDir(),
    skillsDir: config.getSkillsDir(),
    memoryDir: config.getMemoryDir(),
  });

  registerAll(session.pi, FEATURES);

  return session;
}
