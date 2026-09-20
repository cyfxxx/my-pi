/**
 * Browser Feature - Logic
 * 
 * 纯逻辑，零 Pi 依赖
 * 负责浏览器自动化
 */

export interface BrowserConfig {
  enabled: boolean;
  headless: boolean;
  timeout: number;
  viewport?: { width: number; height: number };
}

export interface BrowserState {
  active: boolean;
  currentUrl: string | null;
  pages: string[];
}

// ── 配置管理 ──

export function createBrowserConfig(): BrowserConfig {
  return {
    enabled: true,
    headless: true,
    timeout: 30000,
    viewport: { width: 1280, height: 720 },
  };
}

// ── 浏览器状态 ──

export function createBrowserState(): BrowserState {
  return {
    active: false,
    currentUrl: null,
    pages: [],
  };
}

// ── URL 验证 ──

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// ── 页面导航 ──

export function navigate(state: BrowserState, url: string): boolean {
  if (!isValidUrl(url)) return false;
  state.active = true;
  state.currentUrl = url;
  if (!state.pages.includes(url)) {
    state.pages.push(url);
  }
  return true;
}

// ── 关闭浏览器 ──

export function closeBrowser(state: BrowserState): void {
  state.active = false;
  state.currentUrl = null;
  state.pages = [];
}