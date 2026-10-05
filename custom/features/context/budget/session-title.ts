/**
 * 会话标题规范化（纯逻辑，零 Pi 依赖）
 *
 * 背景：模型经 `session_title` 工具设置会话标题。标题只写入 pi 的会话元数据
 * （`session_info` 条目，append-only），**不进 LLM 上下文**，因此不影响提示词前缀
 * 与缓存命中。pi 的 `appendSessionInfo` 只把换行折叠为空格并 trim，没有长度上限；
 * 这里补上转义/控制字符清理与 UTF-8 字节上限，避免超长或多行标题污染会话列表/页脚。
 *
 * 稳定性：纯函数，同输入必同输出（无时间/随机/环境依赖）。
 */

import { truncateUtf8Safe } from './workspace-instructions';

/** 会话标题 UTF-8 字节上限（单行展示，超出按字符边界截断） */
export const MAX_SESSION_TITLE_BYTES = 120;

/** ANSI 转义序列（ESC[ ... 终止字节）与控制字符 */
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * 规范化标题文本：剥离 ANSI 转义、把控制字符与连续空白折叠为单个空格、
 * 首尾去空白，并按 UTF-8 字节上限安全截断（不切断多字节字符）。
 */
export function normalizeSessionTitle(
  input: string,
  maxBytes: number = MAX_SESSION_TITLE_BYTES,
): string {
  const collapsed = input
    .replace(ANSI_ESCAPE, '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateUtf8Safe(collapsed, maxBytes).trimEnd();
}
