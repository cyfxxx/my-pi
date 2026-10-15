/**
 * `@earendil-works/pi-coding-agent` 的 **DSH 侧 shim**（把该 specifier 别名到本包）
 *
 * ## 为什么只导出两个符号
 *
 * 本仓对 `pi-coding-agent` 的引用绝大多数是 `import type`（编译期擦除）；
 * **运行时**只有两处（可复跑核对）：
 *
 *     grep -rn "^import " custom --include='*.ts' | grep -v 'import type' | grep pi-coding-agent
 *     custom/adapters/ui-adapter.ts:13:      getMarkdownTheme
 *     custom/adapters/session-adapter.ts:9:  SessionManager
 *
 * ⇒ 本 shim 只提供这两个。**多导出一个都是没有依据的**（会把"其实没实现"伪装成实现）。
 *
 * ## 各自的降级契约（都显式上报）
 *
 * | 导出 | 行为 | 说明 |
 * |---|---|---|
 * | `getMarkdownTheme()` | 返回最小主题占位对象 | DSH 的表现层不用终端主题；调用方拿到对象后不会崩，但渲染结果无意义（已上报） |
 * | `SessionManager.list(cwd)` / `.listAll()` | **返回 `[]` + 上报** | DSH 的会话是存储模型（`dsh-session`），要真正实现得接它的服务；在那之前"列出会话"显示为空**而不是报错**，但**必须**让人看见这是降级 |
 *
 * ✗ 缺口（如实）：会话枚举/切换在 DSH 上尚未实现 ⇒ 依赖它的 features（link 的会话选择等）在 DSH 上功能不完整。
 */

import { reportShim } from '../report.js';

/** DSH 上没有终端 Markdown 主题；给一个最小占位，避免调用方在渲染路径上崩 */
export function getMarkdownTheme() {
  reportShim('coding-agent.getMarkdownTheme', 'DSH 无终端 Markdown 主题：返回占位对象（表现层应改用 output.render/presentationMeta）');
  return {
    heading: (text) => String(text ?? ''),
    code: (text) => String(text ?? ''),
    link: (text) => String(text ?? ''),
    text: (text) => String(text ?? ''),
  };
}

/** 会话枚举降级：返回空列表并上报（**不抛错**，让上层显示"没有会话"而不是崩） */
export const SessionManager = {
  async list(cwd) {
    reportShim('coding-agent.SessionManager.list', `DSH 侧会话枚举尚未实现（请求 cwd=${String(cwd ?? '')}）⇒ 返回空列表`);
    return [];
  },
  async listAll() {
    reportShim('coding-agent.SessionManager.listAll', 'DSH 侧会话枚举尚未实现 ⇒ 返回空列表');
    return [];
  },
};
