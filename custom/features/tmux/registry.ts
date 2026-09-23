import { existsSync, readFileSync } from 'node:fs';
import { writeJSONSync } from '../../core/atomic-write';
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

export function saveRegistry(reg: Registry): void {
  writeJSONSync(registryPath(), reg);
}

export function registerSession(entry: RegistryEntry): void {
  const reg = loadRegistry();
  reg.sessions[entry.name] = entry;
  saveRegistry(reg);
}

export function unregisterSession(name: string): void {
  const reg = loadRegistry();
  delete reg.sessions[name];
  saveRegistry(reg);
}

export async function pruneRegistry(opts: TmuxOpts): Promise<number> {
  const probe = await runTmux(opts, ['-V'], 5000);
  if (probe.code !== 0) return 0;
  const reg = loadRegistry();
  const dead: string[] = [];
  for (const name of Object.keys(reg.sessions)) {
    const alive = await hasSession(opts, name);
    if (!alive) dead.push(name);
  }
  if (dead.length > 0) {
    const fresh = loadRegistry();
    for (const name of dead) delete fresh.sessions[name];
    saveRegistry(fresh);
  }
  return dead.length;
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
