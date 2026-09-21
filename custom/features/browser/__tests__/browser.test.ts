/**
 * browser 纯逻辑回归测试
 * 覆盖配置解析、临时目录隔离、navigate 协议守卫、upload 敏感文件拒绝（均无需启动浏览器）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config';
import { BrowserManager, shotDir, pdfDir, downloadsDirDefault } from '../impl';

describe('config', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ['PI_BROWSER_HEADLESS', 'PI_BROWSER_VIEWPORT_WIDTH', 'PI_BROWSER_VIEWPORT_HEIGHT', 'PI_WEB_TOOLKIT_PROXY']) {
      saved[k] = process.env[k];
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('默认视口 1280x800', () => {
    delete process.env.PI_BROWSER_VIEWPORT_WIDTH;
    delete process.env.PI_BROWSER_VIEWPORT_HEIGHT;
    const c = loadConfig();
    expect(c.browser.viewport_width).toBe(1280);
    expect(c.browser.viewport_height).toBe(800);
  });

  it('env 覆盖视口与代理（含旧前缀回退）', () => {
    process.env.PI_BROWSER_VIEWPORT_WIDTH = '1024';
    process.env.PI_BROWSER_VIEWPORT_HEIGHT = '768';
    process.env.PI_WEB_TOOLKIT_PROXY = 'http://127.0.0.1:8080';
    const c = loadConfig();
    expect(c.browser.viewport_width).toBe(1024);
    expect(c.browser.viewport_height).toBe(768);
    expect(c.browser.proxy).toBe('http://127.0.0.1:8080');
  });
});

describe('临时目录隔离', () => {
  it('tmp 目录包含 pid', () => {
    const pid = String(process.pid);
    expect(shotDir()).toContain(pid);
    expect(pdfDir()).toContain(pid);
    expect(downloadsDirDefault()).toContain(pid);
  });
});

describe('navigate 协议守卫（无需启动浏览器）', () => {
  it('拒绝 file:// 等非 http(s) 协议', async () => {
    const b = new BrowserManager({ headless: true, viewport_width: 800, viewport_height: 600 });
    await expect(b.navigate('file:///etc/passwd')).rejects.toThrow('协议不支持');
    await expect(b.navigate('ftp://x/y')).rejects.toThrow('协议不支持');
  });

  it('无效 URL 拒绝', async () => {
    const b = new BrowserManager({ headless: true, viewport_width: 800, viewport_height: 600 });
    await expect(b.navigate('not a url')).rejects.toThrow('无效 URL');
  });
});

describe('upload 敏感凭据拒绝（无需启动浏览器）', () => {
  it('拒绝 .ssh / 密钥类路径', async () => {
    const b = new BrowserManager({ headless: true, viewport_width: 800, viewport_height: 600 });
    await expect(b.uploadFile('input[type=file]', '/root/.ssh/id_rsa')).rejects.toThrow('敏感凭据');
    await expect(b.uploadFile('input[type=file]', '/tmp/server.pem')).rejects.toThrow('敏感凭据');
  });
});
