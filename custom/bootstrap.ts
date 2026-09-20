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

// 功能清单：每迁移一个功能，就在这里添加一行
const FEATURES = [
  defineFeature('web-search', registerWebSearch),
  defineFeature('context', registerContext),
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
