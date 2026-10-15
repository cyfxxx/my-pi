/**
 * 会话**稳定键**：pi 用会话文件路径，DSH 的会话是存储模型（没有文件路径）。
 *
 * ## 为什么需要单独一个模块
 *
 * 本仓多处需要"这是哪个会话"作为 map 的键（`portable/agent/modes-sessions.json`、
 * 记忆命名空间、重启请求的 `targetSession`）。pi 侧它是 `SessionManager.getSessionFile()`；
 * 换到 DSH 后 `SessionHeader` 只有 `id`/`createdAt`/`cwd`
 * （`dsh-session/lib/types/types.d.ts`）⇒ **没有文件路径**。
 *
 * 所以把"取键"这件事收拢到一处，并明确区分两种值：
 *
 * | 来源 | 返回值 | 能不能当文件路径用 |
 * |---|---|---|
 * | pi（`getSessionFile()`） | `/path/to/session.jsonl` | 能（重启请求会把它给 supervisor） |
 * | DSH（`getSessionId()`） | `dsh-session:<id>` | **不能** —— 它只是稳定键，不是路径 |
 *
 * 判据是前缀常量 {@link DSH_SESSION_KEY_PREFIX}；调用方要用作路径时必须先判断（见 `isSessionPath`）。
 */

/** DSH 会话键的前缀（不是路径，只是稳定标识） */
export const DSH_SESSION_KEY_PREFIX = 'dsh-session:';

/** 取稳定键：pi 的文件路径 → DSH 的 `dsh-session:<id>` → 都没有则 undefined */
export function sessionKeyOf(ctx: {
  sessionManager?: {
    getSessionFile?: () => string | undefined;
    getSessionId?: () => string | undefined;
  };
}): string | undefined {
  const call = (fn: (() => string | undefined) | undefined): string | undefined => {
    try {
      const v = fn?.();
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  };
  const file = call(ctx?.sessionManager?.getSessionFile);
  if (file) return file;
  const id = call(ctx?.sessionManager?.getSessionId);
  return id ? `${DSH_SESSION_KEY_PREFIX}${id}` : undefined;
}

/** 这个稳定键能否当**文件路径**用（重启请求的 `targetSession` 只接受路径） */
export function isSessionPath(key: string | undefined): key is string {
  return typeof key === 'string' && key.length > 0 && !key.startsWith(DSH_SESSION_KEY_PREFIX);
}
