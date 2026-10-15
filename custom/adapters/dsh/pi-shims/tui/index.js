/**
 * `@earendil-works/pi-tui` 的 **DSH 侧 shim**（把该 specifier 别名到本包）
 *
 * ## 为什么需要
 *
 * `custom/adapters/ui-adapter.ts` 在**运行时** import 本包的 7 个符号，而 features
 * （plan-mode / subagent / tmux / browser / voice …）会 `new Text(...)` / `container.addChild(...)`。
 * DSH 没有终端 TUI，也**没有** pi 的包 ⇒ 不提供等价物，这些功能连**加载**都会失败
 * （`ERR_MODULE_NOT_FOUND`），而不是优雅降级。
 *
 * ## 本 shim 的契约（明确到"哪些是真实现、哪些是惰性"）
 *
 * | 导出 | 实现 | 说明 |
 * |---|---|---|
 * | `visibleWidth` / `truncateToWidth` | **真实现**（按东亚宽度计算） | 纯字符串计算，与底座无关；features 用它做对齐/截断 |
 * | `Text` / `Spacer` / `Markdown` / `Container` | **惰性**（可构造、`addChild`/`clear`/`render` 无害） | DSH 上不会渲染到终端；构造与拼接必须不抛错 |
 * | `Key` | **显式键表 + 未知键上报** | 已知键（`ctrlAlt` 等）返回可识别的标记；未知键**上报一次**再返回占位，不静默 |
 *
 * ✗ 保真度缺口（如实）：惰性组件不产生任何可视输出；若某个 features 依赖 TUI 渲染**计算**出值
 *   再用于逻辑，那部分行为在 DSH 上是缺失的（已上报）。真正的 DSH 表现层应改用
 *   `output.render` / `presentationMeta`（见 `custom/adapters/dsh/README.md`）。
 */

import { reportShim } from '../report.js';

// ── 纯计算部分（真实现）─────────────────────────────────────────────────────
/** 东亚宽字符区间（与 pi-tui 的口径一致：CJK/全角算 2 列） */
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/u;

/** 显示宽度（列数） */
export function visibleWidth(text) {
  let width = 0;
  for (const ch of String(text ?? '')) width += WIDE.test(ch) ? 2 : 1;
  return width;
}

/** 按列宽截断（超出时追加省略号；`ellipsis` 传 '' 表示不追加） */
export function truncateToWidth(text, width, ellipsis = '…') {
  const s = String(text ?? '');
  const limit = Math.max(0, Number(width) || 0);
  if (visibleWidth(s) <= limit) return s;
  const ell = String(ellipsis ?? '');
  const ellWidth = visibleWidth(ell);
  const budget = Math.max(0, limit - ellWidth);
  let out = '';
  let used = 0;
  for (const ch of s) {
    const w = WIDE.test(ch) ? 2 : 1;
    if (used + w > budget) break;
    out += ch;
    used += w;
  }
  return out + (ellWidth <= limit ? ell : '');
}

// ── 惰性组件（可构造、可拼接，不渲染）──────────────────────────────────────
class InertComponent {
  constructor(...args) {
    this.args = args;
    this.children = [];
    reportShim('tui.component', 'DSH 无终端 TUI：这些组件只做惰性占位，不会产生可视输出（表现层应改用 output.render/presentationMeta）');
  }
  addChild(child) {
    this.children.push(child);
    return this;
  }
  addChildren(children) {
    for (const child of children ?? []) this.children.push(child);
    return this;
  }
  clear() {
    this.children.length = 0;
    return this;
  }
  render() {
    return [];
  }
}

export class Text extends InertComponent {}
export class Spacer extends InertComponent {}
export class Markdown extends InertComponent {}
export class Container extends InertComponent {}

/** 已知键（features 实测只用到 `ctrlAlt`，其余为常用键，先给全免得常见用法落到"未知键"分支） */
const KNOWN_KEYS = {
  ctrlAlt: (key) => `ctrl+alt+${String(key)}`,
  ctrl: (key) => `ctrl+${String(key)}`,
  alt: (key) => `alt+${String(key)}`,
  shift: (key) => `shift+${String(key)}`,
  enter: 'enter',
  escape: 'escape',
  tab: 'tab',
  shiftTab: 'shift+tab',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
};

/**
 * `Key`：显式键表 + **未知键上报**（用 Proxy 是为了不因缺键而抛错，
 * 同时保证"用了没实现的键"一定能被看见，而不是拿一个 undefined 静默失败）。
 */
export const Key = new Proxy(KNOWN_KEYS, {
  get(target, prop) {
    if (typeof prop === 'symbol') return target[prop];
    if (prop in target) return target[prop];
    reportShim(`tui.Key.${String(prop)}`, '该键在 shim 里未实现：已返回占位标记（DSH 的快捷键在客户端层，内核无对应）');
    return (key) => `unknown-key:${String(prop)}:${String(key ?? '')}`;
  },
});
