/**
 * 功能注册表
 * 
 * 职责：集中管理所有功能的注册
 * 约束：
 *   - 每个功能必须通过此注册表注册
 *   - 不允许在 bootstrap.ts 之外直接调用 features
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export type FeatureRegister = (pi: ExtensionAPI) => void;

interface RegisteredFeature {
  name: string;
  register: FeatureRegister;
}

/**
 * 注册一个功能
 */
export function defineFeature(name: string, register: FeatureRegister): RegisteredFeature {
  return { name, register };
}

/**
 * 将所有功能注册到 Pi
 */
export function registerAll(pi: ExtensionAPI, featureList: RegisteredFeature[]): void {
  for (const feature of featureList) {
    try {
      feature.register(pi);
    } catch (error) {
      console.error(`❌ 注册功能失败：${feature.name}`, error);
      throw error;
    }
  }
}
