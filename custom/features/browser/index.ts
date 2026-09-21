/**
 * Browser Feature — 入口（只通过 adapters 与 Pi 交互）
 *
 * 迁移自 pi-tools `agent/extensions/pi-browser/{index.ts,browser/tools/*}`。
 * 18 个浏览器工具 + 生命周期清理钩子。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerHook } from '../../adapters/hook-adapter';
import { registerTool } from '../../adapters/tool-adapter';
import { BrowserManager } from './impl';
import { loadConfig } from './config';

const HELP = `浏览器工具集:
  browser_navigate(url, text_mode?)      导航到 URL（summary/full/none）
  browser_screenshot(full_page?)         截图并保存
  browser_click(x?, y?, selector?, button?)  点击坐标或元素
  browser_type(text, selector?)          输入文本
  browser_scroll(direction?, amount?)    滚动页面
  browser_extract(selector?)             提取文本
  browser_evaluate(script)               执行 JS
  browser_find(selector)                 穿透 Shadow DOM 定位元素
  browser_wait_for(selector?, state?, timeout?)  等待元素/网络空闲
  browser_network(...)                   查询网络请求日志
  browser_select_option(selector, value, by_label?)  下拉框选择
  browser_dialog(mode?, text?)           弹窗处理策略
  browser_download(dir?)                 查看/设置下载目录
  browser_upload(selector, path)         上传文件
  browser_cookies(action, url?, name?, value?)  cookie 读写
  browser_pdf(path?)                     导出 PDF
  browser_close()                        关闭浏览器
  browser_help()                         本帮助`;

export function register(pi: ExtensionAPI): void {
  const cfg = loadConfig();
  const browser = new BrowserManager(cfg.browser, () => process.env.PI_BROWSER_PROXY || null);
  const requirePage = (): void => {
    if (!browser.isPageActive()) throw new Error('尚未打开任何页面。请先调用 browser_navigate。');
  };

  registerTool(pi, {
    name: 'browser_navigate',
    description: '在浏览器中打开 URL。text_mode: summary（默认，标题+关键段落）/ full（整页文本）/ none。',
    parameters: {
      url: { type: 'string', description: '完整 URL（含协议，如 https://）' },
      text_mode: { type: 'string', enum: ['summary', 'full', 'none'], description: '文本提取模式', optional: true },
    },
    execute: async (args) => {
      const info = await browser.navigate(args.url as string);
      const mode = (args.text_mode as string) ?? 'summary';
      if (mode === 'none') return `已导航: ${info.title}\n${info.url}`;
      if (mode === 'full') return `已导航: ${info.title}\n${info.url}\n\n${info.textContent.slice(0, 8000)}`;
      const s = await browser.smartExtract();
      return `已导航: ${info.title}\n${info.url}\n\n${s.summary || info.textContent.slice(0, 4000)}`;
    },
  });

  registerTool(pi, {
    name: 'browser_screenshot',
    description: '对当前页面截图并保存到本地，返回文件路径。',
    parameters: { full_page: { type: 'boolean', description: '是否整页截图', optional: true } },
    execute: async (args) => {
      requirePage();
      return `截图已保存: ${await browser.screenshot(Boolean(args.full_page))}`;
    },
  });

  registerTool(pi, {
    name: 'browser_click',
    description: '点击页面：提供 selector 用元素点击，否则用 x/y 坐标。',
    parameters: {
      x: { type: 'number', description: 'X 坐标', optional: true },
      y: { type: 'number', description: 'Y 坐标', optional: true },
      selector: { type: 'string', description: 'CSS 选择器（与 x/y 互斥）', optional: true },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键', optional: true },
    },
    execute: async (args) => {
      requirePage();
      const selector = args.selector as string | undefined;
      if (selector) {
        await browser.clickSelector(selector);
        return `已点击元素: ${selector}`;
      }
      const x = args.x as number | undefined;
      const y = args.y as number | undefined;
      if (typeof x !== 'number' || typeof y !== 'number') return '请提供 selector 或同时提供 x/y 坐标';
      await browser.click(x, y, (args.button as 'left' | 'right' | 'middle') ?? 'left');
      return `已点击坐标 (${x}, ${y})`;
    },
  });

  registerTool(pi, {
    name: 'browser_type',
    description: '输入文本（提供 selector 时填入该元素，否则在焦点处键入）。',
    parameters: {
      text: { type: 'string', description: '要输入的文本' },
      selector: { type: 'string', description: '目标输入框 CSS 选择器（可选）', optional: true },
    },
    execute: async (args) => {
      requirePage();
      await browser.typeText(args.text as string, args.selector as string | undefined);
      return `已输入 ${String(args.text).length} 个字符`;
    },
  });

  registerTool(pi, {
    name: 'browser_scroll',
    description: '滚动当前页面。',
    parameters: {
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: '滚动方向', optional: true },
      amount: { type: 'number', description: '像素数（默认一个视口高度）', optional: true },
    },
    execute: async (args) => {
      requirePage();
      const dir = (args.direction as string) ?? 'down';
      const amount = (args.amount as number) ?? 600;
      const dx = dir === 'left' ? -amount : dir === 'right' ? amount : 0;
      const dy = dir === 'up' ? -amount : dir === 'down' ? amount : 0;
      await browser.scroll(dx, dy);
      return `已向 ${dir} 滚动 ${amount}px`;
    },
  });

  registerTool(pi, {
    name: 'browser_extract',
    description: '提取页面（或指定选择器）的文本内容。',
    parameters: { selector: { type: 'string', description: 'CSS 选择器（留空提取整页）', optional: true } },
    execute: async (args) => {
      requirePage();
      const text = await browser.extractContent(args.selector as string | undefined);
      return text || '(无内容)';
    },
  });

  registerTool(pi, {
    name: 'browser_evaluate',
    description: '在页面中执行 JavaScript，返回 JSON 序列化结果。',
    parameters: { script: { type: 'string', description: '要执行的 JS 表达式' } },
    execute: async (args) => {
      requirePage();
      const out = await browser.evaluate(args.script as string);
      return JSON.stringify(out, null, 2).slice(0, 8000);
    },
  });

  registerTool(pi, {
    name: 'browser_find',
    description: '穿透 Shadow DOM 查找首个匹配元素，返回中心坐标与文本。',
    parameters: { selector: { type: 'string', description: 'CSS 选择器' } },
    execute: async (args) => {
      requirePage();
      const found = await browser.findElement(args.selector as string);
      return found ? `找到元素 (${found.x}, ${found.y}): ${found.text}` : `未找到元素: ${args.selector}`;
    },
  });

  registerTool(pi, {
    name: 'browser_wait_for',
    description: '等待选择器到位或网络空闲。',
    parameters: {
      selector: { type: 'string', description: 'CSS 选择器（留空等待网络空闲）', optional: true },
      state: { type: 'string', enum: ['visible', 'attached', 'hidden', 'detached'], description: '等待状态', optional: true },
      timeout: { type: 'number', description: '超时毫秒（默认 10000）', optional: true },
    },
    execute: async (args) => {
      requirePage();
      const r = await browser.waitFor(args.selector as string | undefined, {
        state: args.state as 'visible' | 'attached' | 'hidden' | 'detached' | undefined,
        timeout: args.timeout as number | undefined,
      });
      return r.found ? `等待命中${r.marker ? `（${r.marker}）` : ''}` : '等待超时';
    },
  });

  registerTool(pi, {
    name: 'browser_network',
    description: '查询最近网络请求日志（支持 URL/方法/类型过滤）。',
    parameters: {
      url_pattern: { type: 'string', description: 'URL 过滤（正则或子串）', optional: true },
      method: { type: 'string', description: 'GET/POST 等', optional: true },
      type: { type: 'string', description: 'fetch/xhr/document/image 等', optional: true },
      limit: { type: 'number', description: '返回条数上限（默认 100）', optional: true },
      clear: { type: 'boolean', description: 'true 时清空日志', optional: true },
    },
    execute: async (args) => {
      requirePage();
      if (args.clear === true) {
        browser.clearNetwork();
        return '网络日志已清空';
      }
      const entries = browser.getNetwork(
        { urlPattern: args.url_pattern as string | undefined, method: args.method as string | undefined, type: args.type as string | undefined },
        (args.limit as number) ?? 100,
      );
      return entries.length
        ? entries.map((e) => `${e.status ?? '-'} ${e.method} [${e.type}] ${e.url}`).join('\n')
        : '(无匹配请求)';
    },
  });

  registerTool(pi, {
    name: 'browser_select_option',
    description: '选择 <select> 下拉框选项（按 value 或可见文本）。',
    parameters: {
      selector: { type: 'string', description: '下拉框 CSS 选择器' },
      value: { type: 'string', description: '选项 value 或可见文本' },
      by_label: { type: 'boolean', description: '是否按可见文本匹配', optional: true },
    },
    execute: async (args) => {
      requirePage();
      await browser.selectOption(args.selector as string, args.value as string, Boolean(args.by_label));
      return `已选择: ${args.value}`;
    },
  });

  registerTool(pi, {
    name: 'browser_dialog',
    description: '设置弹窗处理策略（accept/dismiss/input），或查询最近弹窗文本。',
    parameters: {
      mode: { type: 'string', enum: ['accept', 'dismiss', 'input'], description: '处理策略（省略仅查询）', optional: true },
      text: { type: 'string', description: 'mode=input 时填入的文本', optional: true },
    },
    execute: async (args) => {
      requirePage();
      if (args.mode) {
        browser.setDialogMode(args.mode as 'accept' | 'dismiss' | 'input', args.text as string | undefined);
        return `弹窗策略已设为 ${args.mode}`;
      }
      const last = browser.getLastDialog();
      return last === null ? '(尚无弹窗)' : `最近弹窗: ${last}`;
    },
  });

  registerTool(pi, {
    name: 'browser_download',
    description: '查看已下载文件列表，或设置下载保存目录。',
    parameters: { dir: { type: 'string', description: '设置下载目录（可选）', optional: true } },
    execute: async (args) => {
      const files = browser.downloads(args.dir as string | undefined);
      if (!files.length) return args.dir ? `下载目录已设为: ${args.dir}` : '(暂无下载)';
      return files.map((f) => `${f.filename} ← ${f.url}`).join('\n');
    },
  });

  registerTool(pi, {
    name: 'browser_upload',
    description: '向 <input type="file"> 设置要上传的本地文件路径（拒绝敏感凭据文件）。',
    parameters: {
      selector: { type: 'string', description: '文件输入框 CSS 选择器' },
      path: { type: 'string', description: '本地文件绝对路径' },
    },
    execute: async (args) => {
      requirePage();
      await browser.uploadFile(args.selector as string, args.path as string);
      return `已设置上传文件: ${args.path}`;
    },
  });

  registerTool(pi, {
    name: 'browser_cookies',
    description: '读取（get）或新增（set）cookie。',
    parameters: {
      action: { type: 'string', enum: ['get', 'set'], description: 'get=读取，set=新增' },
      url: { type: 'string', description: 'set 时必填：cookie 所属 URL', optional: true },
      name: { type: 'string', description: 'set 时必填：cookie 名', optional: true },
      value: { type: 'string', description: 'set 时必填：cookie 值', optional: true },
    },
    execute: async (args) => {
      requirePage();
      if (args.action === 'set') {
        if (!args.url || !args.name || !args.value) return 'set 需要 url/name/value';
        await browser.setCookie(args.url as string, args.name as string, args.value as string);
        return `已设置 cookie: ${args.name}`;
      }
      const cs = await browser.getCookies(args.url as string | undefined);
      return cs.length ? cs.map((c) => `${c.domain} ${c.name}=${c.value}`).join('\n') : '(无 cookie)';
    },
  });

  registerTool(pi, {
    name: 'browser_pdf',
    description: '将当前页面打印为 PDF 并返回文件路径。',
    parameters: { path: { type: 'string', description: '保存路径（可选）', optional: true } },
    execute: async (args) => {
      requirePage();
      return `PDF 已保存: ${await browser.exportPdf(args.path as string | undefined)}`;
    },
  });

  registerTool(pi, {
    name: 'browser_help',
    description: '显示浏览器工具用法帮助。',
    parameters: {},
    execute: async () => HELP,
  });

  registerTool(pi, {
    name: 'browser_close',
    description: '关闭浏览器并释放资源。',
    parameters: {},
    execute: async () => {
      await browser.close();
      return '浏览器已关闭';
    },
  });

  registerHook(pi, {
    event: 'session_start',
    handler: async (_event, ctx) => {
      if (ctx.hasUI && browser.isPageActive()) ctx.ui.notify('浏览器会话已就绪', 'info');
    },
  });

  registerHook(pi, {
    event: 'session_shutdown',
    handler: async () => {
      await browser.close().catch(() => {});
    },
  });
}
