/**
 * tmux 会话注册表（纯逻辑，零 Pi 依赖）
 *
 * 并发模型：注册表是「读-改-写」文件，多实例（多个 pi 进程/后台脚本）并发时
 * 会有丢更新窗口。所有写入口统一经 `mutateRegistry` —— 在同一把跨进程文件锁
 * （`<registryPath>.lock`，默认 `portable/memory/tmux-registry.json.lock`）内完成
 * 「读 → 改 → 原子写」；锁实现见 core/file-lock.ts。
 *
 * `loadRegistry` 为只读入口，不加锁：写入走 write-tmp+rename 原子替换，读者永远
 * 看到一份完整 JSON（旧版或新版），不会读到半截文件；加锁反而会让读者等待写者、
 * 并无额外收益。pruneRegistry 的存活探测（可能耗时数秒的 tmux 调用）在锁外完成，
 * 只在最后删除阶段短暂持锁并基于锁内最新快照二次校验，避免长时间占锁。
 */

import { existsSync, readFileSync } from 'node:fs';
import { writeJSONSync } from '../../core/atomic-write';
import { withFileLock, type FileLockOptions } from '../../core/file-lock';
import { type TmuxOpts, registryPath, isPiSession } from './config';
import { type SessionInfo, runTmux, hasSession, killSession } from './session';

export interface RegistryEntry {
  name: string;
  logPath: string;
  command: string;
  createdAt: string;
  owner?: string;
}

export interface Registry {
  sessions: Record<string, RegistryEntry>;
}

/** 注册表锁路径（与注册表同目录；PI_TMUX_REGISTRY 覆盖时锁随之移动） */
export function registryLockPath(): string {
  return `${registryPath()}.lock`;
}

/** 测试/运维可调：PI_TMUX_LOCK_TIMEOUT_MS、PI_TMUX_LOCK_STALE_MS */
function lockOptions(): Pick<FileLockOptions, 'timeoutMs' | 'staleMs'> {
  const opts: Pick<FileLockOptions, 'timeoutMs' | 'staleMs'> = {};
  const timeout = Number(process.env.PI_TMUX_LOCK_TIMEOUT_MS);
  if (Number.isFinite(timeout) && timeout >= 0) opts.timeoutMs = timeout;
  const stale = Number(process.env.PI_TMUX_LOCK_STALE_MS);
  if (Number.isFinite(stale) && stale > 0) opts.staleMs = stale;
  return opts;
}

/** 只读加载：原子写保证读者看到的始终是完整 JSON；损坏则视为空表重建 */
export function loadRegistry(): Registry {
  try {
    if (existsSync(registryPath())) {
      return JSON.parse(readFileSync(registryPath(), 'utf-8')) as Registry;
    }
  } catch {
    /* 损坏则重建 */
  }
  return { sessions: {} };
}

/** 低层整表原子写；RMW 请走 registerSession/unregisterSession/pruneRegistry（持锁） */
export function saveRegistry(reg: Registry): void {
  writeJSONSync(registryPath(), reg);
}

/** 通用持锁 RMW：读 → 变更 → （有变更才）原子写 */
function mutateRegistry<T>(mutate: (reg: Registry) => { changed: boolean; result: T }): T {
  return withFileLock(
    registryLockPath(),
    () => {
      const reg = loadRegistry();
      const { changed, result } = mutate(reg);
      if (changed) saveRegistry(reg);
      return result;
    },
    lockOptions(),
  );
}

export function registerSession(entry: RegistryEntry): void {
  mutateRegistry((reg) => {
    reg.sessions[entry.name] = entry;
    return { changed: true, result: undefined };
  });
}

export function unregisterSession(name: string): void {
  mutateRegistry((reg) => {
    const changed = name in reg.sessions;
    delete reg.sessions[name];
    return { changed, result: undefined };
  });
}

export async function pruneRegistry(opts: TmuxOpts): Promise<number> {
  const probe = await runTmux(opts, ['-V'], 5000);
  if (probe.code !== 0) return 0;
  // 存活探测在锁外（tmux 调用可能耗时数秒，不能占着锁）
  const snapshot = loadRegistry();
  const dead: string[] = [];
  for (const name of Object.keys(snapshot.sessions)) {
    const alive = await hasSession(opts, name);
    if (!alive) dead.push(name);
  }
  if (dead.length === 0) return 0;
  // 删除阶段短暂持锁，基于锁内最新快照二次校验（其他进程可能已重新注册同名会话）
  return mutateRegistry((fresh) => {
    let removed = 0;
    for (const name of dead) {
      if (name in fresh.sessions) {
        delete fresh.sessions[name];
        removed++;
      }
    }
    return { changed: removed > 0, result: removed };
  });
}

/** shutdown 清理：仅杀 owner===selfOwner 或无主的 pi- 会话 */
export async function shutdownCleanup(
  opts: TmuxOpts,
  reg: Registry,
  sessions: SessionInfo[],
  prefix: string,
  selfOwner: string,
  kill: (o: TmuxOpts, name: string) => Promise<void> = killSession,
): Promise<{ killed: string[]; skippedOthers: string[] }> {
  const killed: string[] = [];
  const skippedOthers: string[] = [];
  for (const s of sessions) {
    if (!isPiSession(s.name, prefix)) continue;
    const entry = reg.sessions[s.name];
    if (!entry) continue;
    if (entry.owner && entry.owner !== selfOwner) {
      skippedOthers.push(s.name);
      continue;
    }
    try {
      await kill(opts, s.name);
      killed.push(s.name);
    } catch {
      /* 单个失败不影响其余清理 */
    }
  }
  return { killed, skippedOthers };
}
