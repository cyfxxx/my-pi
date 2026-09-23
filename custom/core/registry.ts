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
 *
 * 逐个尝试注册，即使某个功能注册失败也会继续注册后续功能，
 * 避免单一失败导致整个链路中断。
 */
export function registerAll(pi: ExtensionAPI, featureList: RegisteredFeature[]): void {
  const failures: string[] = [];
  for (const feature of featureList) {
    try {
      feature.register(pi);
    } catch (error) {
      const msg = `⚠️ 注册功能失败：${feature.name}`;
      console.error(msg, error);
      failures.push(msg);
    }
  }
  if (failures.length > 0) {
    console.warn(`功能注册完成：${failures.length} 个失败，${featureList.length - failures.length} 个成功`);
  }
}
