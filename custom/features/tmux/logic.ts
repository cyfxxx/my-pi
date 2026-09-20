/**
 * Tmux Feature - Logic
 * 
 * 纯逻辑，零 Pi 依赖
 * 负责 tmux 集成
 */

export interface TmuxConfig {
  enabled: boolean;
  sessionPrefix: string;
  socketPath?: string;
}

export interface TmuxSession {
  name: string;
  active: boolean;
  windows: number;
}

// ── 配置管理 ──

export function createTmuxConfig(): TmuxConfig {
  return {
    enabled: true,
    sessionPrefix: 'pi',
    socketPath: undefined,
  };
}

// ── 会话管理 ──

export function detectTmuxSession(): string | undefined {
  if (!process.env.TMUX) return undefined;
  return process.env.TMUX_SESSION_NAME || undefined;
}

export function formatSessionName(prefix: string, name: string): string {
  return `${prefix}-${name}`;
}

export function parseSessionName(sessionName: string, prefix: string): string {
  if (sessionName.startsWith(prefix + '-')) {
    return sessionName.slice(prefix.length + 1);
  }
  return sessionName;
}

// ── 窗口管理 ──

export function countWindows(sessions: TmuxSession[]): number {
  return sessions.reduce((total, s) => total + s.windows, 0);
}