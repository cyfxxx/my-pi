/**
 * 测试用 @earendil-works/pi-coding-agent stub
 *
 * 背景同 pi-tui-stub.ts：真实 dist 在 vitest 下 import 会卡死。
 * 这里只提供 adapters 运行时用到的导出（ui-adapter 的 getMarkdownTheme、
 * session-adapter 的 SessionManager）。本文件不 import 任何 Pi 包。
 */

export function getMarkdownTheme(): unknown {
  return {};
}

export class SessionManager {
  static async list(_cwd?: string): Promise<unknown[]> {
    return [];
  }
  static async listAll(): Promise<unknown[]> {
    return [];
  }
}
