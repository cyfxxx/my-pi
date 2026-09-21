/**
 * Browser Feature — BrowserManager（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-browser/browser/impl.ts`。
 * 浏览器引擎：cloakbrowser（Playwright 兼容）。
 */

import { launch } from 'cloakbrowser';
import type { Browser, Page, Download } from 'playwright-core';
import type { BrowserConfig, PageInfo, NetworkEntry, DialogMode, DownloadFile } from './types';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { isUrlAllowed } from '../../core/net-guard';
import { getAgentDir, getMemoryDir } from '../../core/config';

const SENSITIVE_SEGMENTS = [
  '/.ssh/',
  '/.gnupg/',
  '/.aws/',
  '/.kube/',
  '/.config/gcloud/',
  '/.config/gh/',
  '/.docker/',
  '/.password-store/',
  '/.local/share/keyrings/',
  '/.mozilla/',
  '/.config/pi/',
  '/.netrc',
  '/.git-credentials',
  '/.npmrc',
  '/.pypirc',
];

const SENSITIVE_NAMES = [
  '.env',
  'auth.json',
  'models-store.json',
  'modes.json',
  'keybindings.json',
  'trust.json',
  'credentials.json',
  'tokens.json',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
];

const SENSITIVE_EXT_RE = /\.(pem|key|pfx|p12|kdbx)$/i;
const SENSITIVE_SYS_RE = /^\/(proc|sys|dev)\//;
const SENSITIVE_ETC = ['/etc/shadow', '/etc/gshadow', '/etc/sudoers'];

/**
 * 上传敏感路径判定（prompt 注入防护）：拒绝系统凭据/私钥目录、密钥文件，
 * 以及 my-pi 运行时数据目录（含 auth.json / models 等）。
 */
export function isSensitiveUploadPath(realPath: string): boolean {
  const p = realPath.replace(/\\/g, '/');
  const lowered = p.toLowerCase();
  const base = basename(p).toLowerCase();
  if (SENSITIVE_SYS_RE.test(lowered) || SENSITIVE_ETC.some((s) => lowered.startsWith(s))) return true;
  if (SENSITIVE_EXT_RE.test(lowered)) return true;
  if (SENSITIVE_SEGMENTS.some((s) => lowered.includes(s))) return true;
  if (SENSITIVE_NAMES.includes(base) || /^\.env(\.|$)/.test(base)) return true;
  for (const dir of [getAgentDir(), getMemoryDir()]) {
    try {
      const rd = realpathSync(resolve(dir)).replace(/\\/g, '/').toLowerCase();
      if (lowered === rd || lowered.startsWith(`${rd}/`)) return true;
    } catch {
      /* 目录不存在则跳过 */
    }
  }
  return false;
}

export function shotDir(): string {
  return join(tmpdir(), `my-pi-browser-screenshots-${process.pid}`);
}
export function pdfDir(): string {
  return join(tmpdir(), `my-pi-browser-pdf-${process.pid}`);
}
export function downloadsDirDefault(): string {
  return join(tmpdir(), `my-pi-browser-downloads-${process.pid}`);
}

export function ensureLocalBinaryEnv(): void {
  const envBin = process.env.CLOAKBROWSER_BINARY_PATH;
  if (envBin) {
    const abs = resolve(envBin);
    if (existsSync(abs)) {
      process.env.CLOAKBROWSER_BINARY_PATH = abs;
      return;
    }
  }
  if (process.env.CLOAKBROWSER_BINARY_PATH) delete process.env.CLOAKBROWSER_BINARY_PATH;
  if (process.platform !== 'win32') return;
  const root = process.env.USERPROFILE || homedir();
  try {
    const cacheDir = join(root, '.cloakbrowser');
    if (existsSync(cacheDir)) {
      for (const entry of readdirSync(cacheDir)) {
        if (entry.startsWith('chromium-')) {
          const chrome = join(cacheDir, entry, 'chrome.exe');
          if (existsSync(chrome)) {
            process.env.CLOAKBROWSER_BINARY_PATH = chrome;
            return;
          }
        }
      }
    }
  } catch {
    /* 回退 */
  }
  const chrome = join(root, 'tools', 'chrome-win64', 'chrome.exe');
  if (existsSync(chrome)) process.env.CLOAKBROWSER_BINARY_PATH = chrome;
}

function isProtocolSecurityError(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.message.startsWith('重定向到不允许的协议') || e.message.startsWith('协议不支持'))
  );
}

export class BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private config: BrowserConfig;
  private getProxyUrl: (() => string | null) | null;
  private initializing: Promise<Browser> | null = null;
  private networkLog: NetworkEntry[] = [];
  private dialogMode: DialogMode = 'dismiss';
  private dialogText: string | null = null;
  private lastDialog: string | null = null;
  private readonly MAX_NETWORK = 1000;
  private downloadsDir = downloadsDirDefault();
  private downloadedFiles: DownloadFile[] = [];
  private readonly activeDownloads = new Set<string>();
  private downloadSeq = 0;

  constructor(config: BrowserConfig, getProxyUrl?: () => string | null) {
    this.config = config;
    this.getProxyUrl = getProxyUrl ?? null;
  }

  async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.initializing) return this.initializing;
    this.initializing = this.launchBrowser().catch((e) => {
      this.initializing = null;
      throw e;
    });
    try {
      const browser = await this.initializing;
      this.networkLog = [];
      this.dialogText = null;
      this.lastDialog = null;
      return browser;
    } finally {
      this.initializing = null;
    }
  }

  private async launchBrowser(): Promise<Browser> {
    ensureLocalBinaryEnv();
    const proxyUrl = this.getProxyUrl?.();
    const hasExplicitProxy = Boolean(proxyUrl ?? this.config.proxy);
    const opts: Record<string, unknown> = {
      headless: this.config.headless,
      ...(process.platform === 'win32' && !hasExplicitProxy ? { args: ['--no-proxy-server'] } : {}),
    };
    if (this.config.fingerprint_seed) {
      opts.fingerprint = this.config.fingerprint_seed;
    }
    if (proxyUrl) opts.proxy = { server: proxyUrl };
    else if (this.config.proxy) opts.proxy = { server: this.config.proxy };
    if (this.config.data_dir) opts.userDataDir = this.config.data_dir;
    this.browser = await launch(opts as Parameters<typeof launch>[0]);
    return this.browser;
  }

  private async ensurePage(): Promise<Page> {
    await this.ensureBrowser();
    if (this.page && !this.page.isClosed()) return this.page;
    this.page = await this.browser!.newPage();
    await this.page.setViewportSize({ width: this.config.viewport_width, height: this.config.viewport_height });
    const pg = this.page as Page;
    pg.on('request', (req) => {
      if (this.networkLog.length >= this.MAX_NETWORK) this.networkLog.shift();
      this.networkLog.push({ url: req.url(), method: req.method(), type: req.resourceType(), timestamp: Date.now() });
    });
    pg.on('response', (res) => {
      for (let i = this.networkLog.length - 1; i >= 0; i--) {
        if (this.networkLog[i].url === res.url() && this.networkLog[i].status === undefined) {
          this.networkLog[i].status = res.status();
          break;
        }
      }
    });
    pg.on('dialog', (dialog) => {
      this.lastDialog = dialog.message();
      const action =
        this.dialogMode === 'accept'
          ? dialog.accept()
          : this.dialogMode === 'input'
            ? dialog.accept(this.dialogText ?? '')
            : dialog.dismiss();
      action.catch((err: unknown) => console.warn('[browser] dialog action error:', (err as Error)?.message));
    });
    pg.on('download', (download) => {
      const filename = download.suggestedFilename();
      this.saveDownload(download, filename).catch((err) => console.warn('[browser] download save error:', (err as Error)?.message));
    });
    return this.page;
  }

  async navigate(url: string, signal?: AbortSignal): Promise<PageInfo> {
    try {
      const proto = new URL(url).protocol;
      if (proto !== 'http:' && proto !== 'https:') {
        throw new Error(`协议不支持: ${proto}//（仅允许 http/https，拒绝 ${url.slice(0, 60)}）`);
      }
      if (!isUrlAllowed(url)) {
        throw new Error(`拒绝访问内网/回环地址（仅允许公网 http/https）`);
      }
    } catch (e) {
      if (e instanceof Error && (e.message.startsWith('协议不支持') || e.message.startsWith('拒绝访问'))) throw e;
      throw new Error(`无效 URL: ${String(url).slice(0, 80)}`);
    }
    const page = await this.ensurePage();
    const errors: Error[] = [];
    for (const waitUntil of ['networkidle', 'load'] as const) {
      try {
        const gotoOpts: Record<string, unknown> = { waitUntil, timeout: 30000 };
        if (signal) gotoOpts.signal = signal;
        await page.goto(url, gotoOpts);
        const finalUrl = page.url();
        if (finalUrl && finalUrl !== 'about:blank') {
          let fp: string;
          try {
            fp = new URL(finalUrl).protocol;
          } catch {
            throw new Error(`导航失败: 无效的最终 URL ${String(finalUrl).slice(0, 80)}`);
          }
          if (fp !== 'http:' && fp !== 'https:') {
            throw new Error(`重定向到不允许的协议: ${fp}//（浏览器已拦截 ${finalUrl.slice(0, 60)}）`);
          }
        }
        return this.getPageInfo();
      } catch (e) {
        if (signal?.aborted) throw new Error('导航已取消');
        if (isProtocolSecurityError(e)) throw e;
        errors.push(e as Error);
      }
    }
    throw new Error(`导航失败: ${errors.map((e) => e.message).join('; ')}`);
  }

  async getPageInfo(): Promise<PageInfo> {
    const page = await this.ensurePage();
    return {
      url: page.url(),
      title: await page.title(),
      content: await page.content(),
      textContent: await page.evaluate(() => document.body?.innerText?.trim() ?? ''),
      viewport: page.viewportSize() ?? { width: 1280, height: 800 },
    };
  }
  async click(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
    const page = await this.ensurePage();
    await page.mouse.click(x, y, { button });
  }
  async clickSelector(selector: string): Promise<void> {
    const page = await this.ensurePage();
    const el = await page.$(selector);
    if (!el) throw new Error(`未找到元素: ${selector}`);
    const box = await el.boundingBox();
    if (!box) throw new Error(`元素不可见: ${selector}`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  async typeText(text: string, selector?: string): Promise<void> {
    const page = await this.ensurePage();
    if (selector) await page.fill(selector, text);
    else await page.keyboard.type(text, { delay: 10 });
  }
  async scroll(deltaX: number, deltaY: number): Promise<void> {
    const page = await this.ensurePage();
    await page.evaluate(({ dx, dy }: { dx: number; dy: number }) => window.scrollBy(dx, dy), { dx: deltaX, dy: deltaY });
  }
  async screenshot(fullPage = false): Promise<string> {
    const page = await this.ensurePage();
    const dir = shotDir();
    await mkdir(dir, { recursive: true });
    const path = join(dir, `pi-screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
    await page.screenshot({ path, fullPage });
    return path;
  }
  async evaluate(expression: string): Promise<unknown> {
    const page = await this.ensurePage();
    return page.evaluate(expression);
  }
  async extractContent(selector?: string): Promise<string> {
    const page = await this.ensurePage();
    if (selector) {
      return page.evaluate((sel: string) => document.querySelector(sel)?.textContent?.trim() ?? '', selector);
    }
    return page.evaluate(() => document.body?.innerText?.trim() ?? '');
  }
  async smartExtract(): Promise<{ summary: string; keyPoints: string[]; fullText: string }> {
    const page = await this.ensurePage();
    const fullText = await page.evaluate(() => document.body?.innerText?.trim() ?? '');
    const structured = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
        .map((h) => ({ tag: h.tagName, text: (h as HTMLElement).innerText?.trim() }))
        .filter((h) => h.text);
      const paragraphs = Array.from(document.querySelectorAll('p, li, td, blockquote'))
        .map((el) => (el as HTMLElement).innerText?.trim())
        .filter((t) => t && t.length > 20);
      return { headings: headings.slice(0, 15), paragraphs: paragraphs.slice(0, 30) };
    });
    const summary = [
      ...structured.headings.map((h) => `${h.tag === 'H1' ? '# ' : h.tag === 'H2' ? '## ' : '### '}${h.text}`),
      '',
      ...structured.paragraphs.slice(0, 5).map((p) => p.slice(0, 200)),
    ].join('\n');
    const keyPoints = structured.headings.filter((h) => h.tag !== 'H1').map((h) => h.text!).slice(0, 8);
    return { summary, keyPoints, fullText };
  }
  isPageActive(): boolean {
    if (!this.browser || !this.browser.isConnected()) return false;
    if (!this.page || this.page.isClosed()) return false;
    return true;
  }
  async waitFor(
    selector?: string,
    opts: { state?: 'visible' | 'attached' | 'hidden' | 'detached'; timeout?: number } = {},
  ): Promise<{ found: boolean; marker?: string }> {
    const page = await this.ensurePage();
    const timeout = opts.timeout ?? 10000;
    if (selector) {
      try {
        await page.waitForSelector(selector, { state: opts.state ?? 'visible', timeout });
        return { found: true };
      } catch {
        return { found: false };
      }
    }
    try {
      await page.waitForLoadState('networkidle', { timeout });
      return { found: true, marker: 'networkidle' };
    } catch {
      return { found: false };
    }
  }
  async selectOption(selector: string, value: string, byLabel = false): Promise<void> {
    const page = await this.ensurePage();
    const el = await page.$(selector);
    if (!el) throw new Error(`未找到下拉框: ${selector}`);
    await page.selectOption(selector, byLabel ? { label: value } : value);
  }
  setDialogMode(mode: DialogMode, text?: string): void {
    this.dialogMode = mode;
    this.dialogText = mode === 'input' ? text ?? '' : text ?? null;
  }
  getLastDialog(): string | null {
    return this.lastDialog;
  }
  getNetwork(filter?: { urlPattern?: string; method?: string; type?: string }, limit = 100): NetworkEntry[] {
    let entries = this.networkLog;
    if (filter?.urlPattern) {
      try {
        const re = new RegExp(filter.urlPattern);
        entries = entries.filter((e) => re.test(e.url));
      } catch {
        entries = entries.filter((e) => e.url.includes(filter.urlPattern!));
      }
    }
    if (filter?.method) entries = entries.filter((e) => e.method.toUpperCase() === filter.method!.toUpperCase());
    if (filter?.type) entries = entries.filter((e) => e.type === filter.type);
    return entries.slice(-limit).reverse();
  }
  clearNetwork(): void {
    this.networkLog = [];
  }
  downloads(dir?: string): DownloadFile[] {
    if (dir) this.downloadsDir = dir;
    return this.downloadedFiles.map((f) => ({ ...f }));
  }
  private async saveDownload(download: Download, rawName: string): Promise<void> {
    let filename = basename(rawName.replace(/\\/g, '/'));
    if (filename === '' || filename === '.' || filename === '..') filename = 'download';
    const taken = (): boolean => this.activeDownloads.has(filename) || this.downloadedFiles.some((f) => f.filename === filename);
    if (taken()) {
      const dot = filename.lastIndexOf('.');
      const base = dot > 0 ? filename.slice(0, dot) : filename;
      const ext = dot > 0 ? filename.slice(dot) : '';
      do {
        filename = `${base}-${Date.now()}-${++this.downloadSeq}${ext}`;
      } while (taken());
    }
    this.activeDownloads.add(filename);
    try {
      await mkdir(this.downloadsDir, { recursive: true });
      const target = join(this.downloadsDir, filename);
      await download.saveAs(target);
      this.downloadedFiles.push({ filename, path: target, url: download.url(), timestamp: Date.now() });
    } finally {
      this.activeDownloads.delete(filename);
    }
  }
  async uploadFile(selector: string, path: string): Promise<void> {
    const resolved = resolve(path);
    let real = resolved;
    try {
      real = realpathSync(resolved);
    } catch {
      /* 用原始路径 */
    }
    if (isSensitiveUploadPath(real)) {
      throw new Error(`已拒绝上传疑似敏感凭据文件（prompt 注入防护）：${path} (已解析: ${real})`);
    }
    const page = await this.ensurePage();
    await page.setInputFiles(selector, real);
  }
  async getCookies(url?: string): Promise<{ name: string; value: string; domain: string }[]> {
    const page = await this.ensurePage();
    const cs = await page.context().cookies(url);
    return cs.map((c) => ({ name: c.name, value: (c as { httpOnly?: boolean }).httpOnly ? '<redacted:httpOnly>' : c.value, domain: c.domain }));
  }
  async setCookie(url: string, name: string, value: string): Promise<void> {
    const page = await this.ensurePage();
    await page.context().addCookies([{ name, value, url }]);
  }
  async findElement(selector: string): Promise<{ x: number; y: number; text: string } | null> {
    const page = await this.ensurePage();
    const found = await page.evaluate((sel: string) => {
      const candidates: Element[] = [];
      const walk = (root: Document | ShadowRoot): void => {
        for (const el of Array.from(root.querySelectorAll(sel))) candidates.push(el);
        for (const el of Array.from(root.querySelectorAll('*'))) {
          const sr = (el as HTMLElement).shadowRoot;
          if (sr) walk(sr);
        }
      };
      walk(document);
      if (candidates.length === 0) return null;
      const el = candidates[0] as HTMLElement;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (el.textContent ?? '').trim().slice(0, 200) };
    }, selector);
    return (found as { x: number; y: number; text: string } | null) ?? null;
  }
  async exportPdf(path?: string): Promise<string> {
    const page = await this.ensurePage();
    const target = path ?? join(pdfDir(), `pi-page-${Date.now()}.pdf`);
    await mkdir(dirname(target), { recursive: true });
    await page.pdf({ path: target, printBackground: true });
    return target;
  }
  async close(): Promise<void> {
    if (this.initializing) {
      try {
        await this.initializing;
      } catch {
        /* launch 失败 */
      }
    }
    try {
      if (this.page && !this.page.isClosed()) await this.page.close();
    } catch (e) {
      console.warn('[browser] page close error:', (e as Error).message);
    }
    try {
      if (this.browser) await this.browser.close();
    } catch (e) {
      console.warn('[browser] browser close error:', (e as Error).message);
    }
    this.page = null;
    this.browser = null;
    this.networkLog = [];
    this.lastDialog = null;
    this.dialogMode = 'dismiss';
    this.dialogText = null;
    this.downloadedFiles = [];
  }
}
