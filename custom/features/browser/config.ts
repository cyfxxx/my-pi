/**
 * Browser Feature — 配置加载（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-browser/{config,browser/config}.ts`。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '../../core/config';
import type { BrowserConfig, BrowserOnlyConfig } from './types';

const DEFAULT_CONFIG: BrowserOnlyConfig = {
  browser: { headless: false, viewport_width: 1280, viewport_height: 800 },
};

const CONFIG_KEYS = ['pi-browser', 'pi-web-toolkit'] as const;

function buildBrowserConfig(ext: Record<string, unknown>): Partial<BrowserConfig> {
  const b: Partial<BrowserConfig> = {};
  if (ext.headless != null) b.headless = ext.headless as boolean;
  if (ext.viewport_width != null) b.viewport_width = ext.viewport_width as number;
  if (ext.viewport_height != null) b.viewport_height = ext.viewport_height as number;
  if (ext.fingerprint_seed != null) b.fingerprint_seed = ext.fingerprint_seed as string;
  if (ext.proxy != null) b.proxy = ext.proxy as string;
  if (ext.data_dir != null) b.data_dir = ext.data_dir as string;
  return b;
}

function readConfigFromFile(): Partial<BrowserConfig> {
  const paths = [join(getAgentDir(), 'settings.json'), join(process.cwd(), '.pi', 'settings.json')];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, Record<string, unknown> | undefined>;
      for (const k of CONFIG_KEYS) {
        const section = raw?.[k];
        if (section && typeof section === 'object') return buildBrowserConfig(section);
      }
    } catch {
      continue;
    }
  }
  return {};
}

function envFirst(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function readConfigFromEnv(): Partial<BrowserConfig> {
  const b: Partial<BrowserConfig> = {};
  const headless = envFirst('PI_BROWSER_HEADLESS', 'PI_WEB_TOOLKIT_HEADLESS');
  if (headless) b.headless = ['true', '1', 'yes', 'on'].includes(headless.toLowerCase());
  const vw = envFirst('PI_BROWSER_VIEWPORT_WIDTH', 'PI_WEB_TOOLKIT_VIEWPORT_WIDTH');
  if (vw) {
    const v = parseInt(vw, 10);
    if (!Number.isNaN(v)) b.viewport_width = v;
  }
  const vh = envFirst('PI_BROWSER_VIEWPORT_HEIGHT', 'PI_WEB_TOOLKIT_VIEWPORT_HEIGHT');
  if (vh) {
    const v = parseInt(vh, 10);
    if (!Number.isNaN(v)) b.viewport_height = v;
  }
  const fp = envFirst('PI_BROWSER_FINGERPRINT_SEED', 'PI_WEB_TOOLKIT_FINGERPRINT_SEED');
  if (fp) b.fingerprint_seed = fp;
  const proxy = envFirst('PI_BROWSER_PROXY', 'PI_WEB_TOOLKIT_PROXY');
  if (proxy) b.proxy = proxy;
  return b;
}

export function loadConfig(): BrowserOnlyConfig {
  return { browser: { ...DEFAULT_CONFIG.browser, ...readConfigFromFile(), ...readConfigFromEnv() } };
}
