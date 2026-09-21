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

export function isHanging(maxIdleMinutes: number, now: number = Date.now()): boolean {
  if (maxIdleMinutes <= 0) return false;
  if (backgroundBusy) return false;
  if (busyTurn && busySince > 0 && now - busySince <= maxIdleMinutes * 60 * 1000 * BUSY_GRACE_MULTIPLIER) {
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
export function triggerHangRecovery(maxIdleMinutes: number, now: number = Date.now()): boolean {
  if (!isHanging(maxIdleMinutes, now)) return false;
  const idleMinutes = Math.round((now - lastActivity) / 60000);
  writeRestartRequest('restart_hang', { reason: `会话挂死（${idleMinutes} 分钟无活动）` });
  return true;
}

export function resetWatchdogState(): void {
  lastActivity = Date.now();
  busyTurn = false;
  busySince = 0;
  backgroundBusy = false;
}

