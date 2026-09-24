/**
 * Autopilot Feature — 看门狗（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-autopilot/watchdog.ts`。
 * 检测会话整体挂死（lastActivity + 最新会话 mtime 双信号）；my-pi 无 wrapper，
 * 挂死仅写重启请求 + 由调用方通知，不自动重启。
 */

import { statSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '../../../core/config';
import { writeRestartRequest } from '../store/ops';

let lastActivity = Date.now();
let busyTurn = false;
let busySince = 0;
let backgroundBusy = false;
const BUSY_GRACE_MULTIPLIER = 2;

export function setTurnBusy(busy: boolean): void {
  busyTurn = busy;
  busySince = busy ? Date.now() : 0;
}
export function isTurnBusy(): boolean {
  return busyTurn;
}

/** 后台任务（autopilot setInterval 子进程）运行标记：期间不判定挂死。 */
export function setBackgroundBusy(busy: boolean): void {
  backgroundBusy = busy;
}
export function isBackgroundBusy(): boolean {
  return backgroundBusy;
}
export function touchActivity(): void {
  lastActivity = Date.now();
}
export function lastActivityTs(): number {
  return lastActivity;
}

function latestSessionFile(): string | null {
  const own = process.env.PI_SESSION_FILE;
  if (own) {
    try {
      if (statSync(own).isFile()) return own;
    } catch {
      /* 回退全局扫描 */
    }
  }
  const base = join(getAgentDir(), 'sessions');
  if (!existsSync(base)) return null;
  let best: string | null = null;
  let bestMtime = 0;
  try {
    for (const dir of readdirSync(base)) {
      const full = join(base, dir);
      try {
        if (!statSync(full).isDirectory()) continue;
        for (const f of readdirSync(full)) {
          if (!f.endsWith('.jsonl')) continue;
          const fp = join(full, f);
          const m = statSync(fp).mtimeMs;
          if (m > bestMtime) {
            bestMtime = m;
            best = fp;
          }
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    return null;
  }
  return best;
}

/** 回合进行中的宽限期（毫秒）：超过它仍未结束且无活动，视为卡死。 */
function busyGraceMs(maxIdleMinutes: number): number {
  return maxIdleMinutes * 60 * 1000 * BUSY_GRACE_MULTIPLIER;
}

/**
 * 回合进行中（busyTurn）超过宽限期仍无活动。
 * 与「用户空闲」严格区分：空闲时 busyTurn=false，此处返回 false，因此不会因为
 * 用户离开而触发自动重启；只有回合真的卡住才成立。
 */
export function isStuckTurn(maxIdleMinutes: number, now: number = Date.now()): boolean {
  if (maxIdleMinutes <= 0) return false;
  if (backgroundBusy) return false;
  return busyTurn && busySince > 0 && now - busySince > busyGraceMs(maxIdleMinutes);
}

export function isHanging(maxIdleMinutes: number, now: number = Date.now()): boolean {
  if (maxIdleMinutes <= 0) return false;
  if (backgroundBusy) return false;
  if (busyTurn && busySince > 0 && now - busySince <= busyGraceMs(maxIdleMinutes)) {
    return false;
  }
  const idle = now - lastActivity;
  if (idle <= maxIdleMinutes * 60 * 1000) return false;
  const sessionFile = latestSessionFile();
  if (sessionFile) {
    try {
      if (now - statSync(sessionFile).mtimeMs <= maxIdleMinutes * 60 * 1000) return false;
    } catch {
      /* ignore */
    }
  }
  return true;
}

/** 触发挂死恢复：写重启请求并返回是否触发 */
export function triggerHangRecovery(
  maxIdleMinutes: number,
  now: number = Date.now(),
  sessionFile?: string,
): boolean {
  if (!isHanging(maxIdleMinutes, now)) return false;
  const idleMinutes = Math.round((now - lastActivity) / 60000);
  // 优先用调用方传入的当前会话；否则回退到最近修改的会话文件（可能选错，但优于不带）
  writeRestartRequest('restart_hang', {
    targetSession: sessionFile ?? latestSessionFile() ?? undefined,
    reason: `会话挂死（${idleMinutes} 分钟无活动）`,
  });
  return true;
}

export function resetWatchdogState(): void {
  lastActivity = Date.now();
  busyTurn = false;
  busySince = 0;
  backgroundBusy = false;
}

