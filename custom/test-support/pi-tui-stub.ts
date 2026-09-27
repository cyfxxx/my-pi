/**
 * 测试用 @earendil-works/pi-tui stub
 *
 * vendor/pi 不在根 node_modules，pi 运行时由 jiti 从 vendored 源码加载；
 * 而真实 dist 在 vitest 下 import 会卡死（依赖初始化过重，实测 5s 超时）。
 * 工具层测试只关心注册与 execute，不涉及渲染，故由 vitest.config.ts 的
 * alias 把该包名指向本 stub，避免每个测试文件重复 vi.mock。
 *
 * 本文件不 import 任何 Pi 包，不触碰 custom/ 隔离边界（check-isolation 检查 4）。
 */

export class Key {
  /** 快捷键构造器（plan-mode 等用它注册 Ctrl+Alt+P）；测试只关心返回值可用于注册 */
  static ctrlAlt(key: string): string {
    return `ctrl-alt-${key}`;
  }
  static ctrl(key: string): string {
    return `ctrl-${key}`;
  }
  static alt(key: string): string {
    return `alt-${key}`;
  }
  static shift(key: string): string {
    return `shift-${key}`;
  }
}
export class Container {}
export class Markdown {}
export class Spacer {}
export class Text {}

export function truncateToWidth(input: string): string {
  return input;
}

export function visibleWidth(input: string): number {
  return input.length;
}
