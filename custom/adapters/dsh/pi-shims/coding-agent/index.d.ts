/**
 * `@earendil-works/pi-coding-agent` shim 的类型声明（契约快照）。
 *
 * 只声明本仓**运行时**真正用到的两个符号（依据见同目录 README 的 grep 名单）。
 */
/** DSH 无终端 Markdown 主题 ⇒ 返回最小占位对象（渲染路径不崩，结果无意义） */
export declare function getMarkdownTheme(): {
  heading(text: unknown): string;
  code(text: unknown): string;
  link(text: unknown): string;
  text(text: unknown): string;
};
/** 会话枚举降级：返回空数组并上报（DSH 的会话是存储模型，接入是后续工作） */
export declare const SessionManager: {
  list(cwd?: string): Promise<never[]>;
  listAll(): Promise<never[]>;
};
