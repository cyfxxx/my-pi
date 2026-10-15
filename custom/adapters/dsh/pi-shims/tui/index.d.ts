/**
 * `@earendil-works/pi-tui` shim 的类型声明（契约快照）。
 *
 * 口径：纯计算函数是**真实现**；组件是**惰性**（可构造/拼接，不渲染）。
 * 详见同目录 README.md 与 index.js 的注释。
 */
/** 显示宽度（列数；东亚宽字符算 2） */
export declare function visibleWidth(text: unknown): number;
/** 按列宽截断（超出时追加省略号；`ellipsis` 传 '' 表示不追加） */
export declare function truncateToWidth(text: unknown, width: number, ellipsis?: string): string;

/** 惰性组件基类（DSH 上不渲染，仅保证构造/拼接不抛错） */
declare class InertComponent {
  children: unknown[];
  constructor(...args: unknown[]);
  addChild(child: unknown): this;
  addChildren(children: readonly unknown[]): this;
  clear(): this;
  render(): unknown[];
}
export declare class Text extends InertComponent {}
export declare class Spacer extends InertComponent {}
export declare class Markdown extends InertComponent {}
export declare class Container extends InertComponent {}

/** 键表：已知键返回标记串；未知键返回占位串并上报一次 */
export declare const Key: Record<string, unknown> & {
  ctrlAlt(key: string): string;
  ctrl(key: string): string;
  alt(key: string): string;
  shift(key: string): string;
};
