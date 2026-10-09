/**
 * 错误指纹落盘（缺陷 1 修复，2026-10-08）
 *
 * ## 为什么需要它
 *
 * P7 的"按错误指纹算修复预算"状态此前**只活在内存**（`index.ts` 的 `repairBudget`）——
 * 离线知识层拿不到它。C 项（离线「经验 → 知识」编译器）因此按"证据不足宁可少产出"**没有为它
 * 生成任何 pattern**；而"哪类错误反复出现、换参数还是同一个错"恰恰是"经验 → 知识"的**第一原料**。
 *
 * ## 严格沿用既有惯例（见 `index.ts` 里前缀指纹那段）
 *
 * 运行时**前缀**指纹是 `PI_PREFIX_FINGERPRINT !== 'off'` ⇒ **默认写、可 opt-out**，
 * 文件在 `join(getMemoryDir(), 'logs', <name>.jsonl')`，写入用 `ensureDir` + `appendJSONLRotating`，
 * 且**整段 fail-open**。本模块与接线**完全照抄这套**：默认开（`PI_ERROR_FINGERPRINT=off` 可关）、
 * 同一目录约定、同一 append-only、同一 fail-open。
 *
 * ## 隐私边界（重要）
 *
 * 只写**机器标识**：指纹（`normalizeErrorForFingerprint` 已去掉路径/行号/耗时/哈希）、工具名、
 * 次数、不同参数组数、窗口、时间戳，以及 `excerpt`（同一套归一化后再截断到
 * `FINGERPRINT_EXCERPT_MAX`）。**不写会话正文、不写未归一化的错误原文**。
 */

/** 与 `prefix-fingerprints.jsonl` 相同的轮转上限（单一常量，避免两处漂移） */
export const ERROR_FINGERPRINT_LOG_MAX_BYTES = 1_000_000;

/** 只取结构所需字段，避免与 `RepairObservation` 强耦合（该接口改动不该牵动日志格式） */
export interface FingerprintObservationLike {
  /** 错误指纹（哈希/短标识） */
  key: string;
  /** 归一化 + 截断后的错误摘要 */
  excerpt: string;
  /** 该指纹在窗口内出现的次数（含本次） */
  attempts: number;
  /** 期间用过的不同参数组数 */
  distinctArgs: number;
  /** 本次是否触发了提醒（判定逻辑不变，这里只是**记录**它） */
  remind: boolean;
}

export interface ErrorFingerprintRecord {
  ts: string;
  fingerprint: string;
  tool: string;
  attempts: number;
  distinctArgs: number;
  windowMs: number;
  remind: boolean;
  excerpt: string;
}

/**
 * 纯函数：把一次观察变成一行日志记录。**不含任何时间/IO 副作用**（`nowIso` 由调用方给），
 * 于是可以被单测直接钉住字段与隐私边界。
 */
export function buildErrorFingerprintRecord(
  obs: FingerprintObservationLike,
  toolName: string,
  windowMs: number,
  nowIso: string,
): ErrorFingerprintRecord {
  return {
    ts: nowIso,
    fingerprint: obs.key,
    tool: toolName,
    attempts: obs.attempts,
    distinctArgs: obs.distinctArgs,
    windowMs,
    remind: obs.remind,
    excerpt: obs.excerpt,
  };
}

/** 注入点（默认走 `core/fs-json`；单测可注入会抛错的实现来验证 fail-open） */
export interface FingerprintLogIO {
  ensureDir: (dir: string) => void;
  append: (file: string, obj: unknown, maxBytes: number) => void;
}

/**
 * 追加一行。**fail-open**：任何异常都被吞掉并返回 `false` ——
 * 落盘是**纯诊断**，绝不允许它影响工具结果、错误精简或修复提醒（与既有做法一致）。
 */
export function appendErrorFingerprintRecord(
  file: string,
  rec: ErrorFingerprintRecord,
  io: FingerprintLogIO,
  dirOf: (file: string) => string,
): boolean {
  try {
    io.ensureDir(dirOf(file));
    io.append(file, rec, ERROR_FINGERPRINT_LOG_MAX_BYTES);
    return true;
  } catch {
    return false;
  }
}
