/**
 * tmux 工具（最小可用版）：把会话管理交给本机 tmux，只暴露"跑/看/读/发/停"五件事。
 *
 * 为什么不用 DSH 原生：DSH 只有 `tmux-context`（读取当前 tmux 环境，只读），没有驱动。
 * 为什么自己写：纯 shell 调用、无状态依赖，属于"简单档"回填；不碰宿主内部结构。
 *
 * 命名与安全：只认本插件创建的会话前缀（默认 `mypi-`），list/kill 都按前缀过滤，
 * 避免误杀用户自己的 tmux 会话。
 */
import { execFileSync } from 'node:child_process';

export interface TmuxConfig {
  readonly prefix: string;
  readonly bin: string;
}

export function resolveTmuxConfig(env: Record<string, string | undefined> = process.env): TmuxConfig {
  return {
    prefix: env.MYPI_TMUX_PREFIX ?? 'mypi-',
    bin: env.MYPI_TMUX_BIN ?? 'tmux',
  };
}

export function hasTmux(config: TmuxConfig): boolean {
  try {
    execFileSync(config.bin, ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function tmux(config: TmuxConfig, args: readonly string[], input?: string): string {
  return execFileSync(config.bin, args, { encoding: 'utf8', input, timeout: 20_000 }).trimEnd();
}

/** 只允许操作我们前缀下的会话，且拒绝斜杠/空白等会破坏 tmux 目标语法的字符。 */
export function normalizeName(config: TmuxConfig, raw: string | undefined): string {
  const base = (raw ?? '').trim();
  const safe = base.replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^-+/, '');
  if (safe === '') throw new Error('tmux: 会话名不能为空');
  return safe.startsWith(config.prefix) ? safe : `${config.prefix}${safe}`;
}

export interface TmuxSession {
  readonly name: string;
  readonly windows: number;
  readonly created: string;
}

export function listSessions(config: TmuxConfig): TmuxSession[] {
  if (!hasTmux(config)) throw new Error(`tmux: 找不到可执行文件 ${config.bin}`);
  let out = '';
  try {
    out = tmux(config, ['list-sessions', '-F', '#{session_name}\t#{session_windows}\t#{session_created_string}']);
  } catch {
    return []; // 没有 server / 没有会话
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter((cols) => (cols[0] ?? '').startsWith(config.prefix))
    .map((cols) => ({ name: cols[0] ?? '', windows: Number(cols[1] ?? '0'), created: cols[2] ?? '' }));
}

export function hasSession(config: TmuxConfig, name: string): boolean {
  return listSessions(config).some((session) => session.name === name);
}

export function runSession(config: TmuxConfig, name: string, command: string, cwd?: string): string {
  if (!hasTmux(config)) throw new Error(`tmux: 找不到可执行文件 ${config.bin}`);
  if (hasSession(config, name)) throw new Error(`tmux: 会话 ${name} 已存在（先 tmux_stop 或换个名字）`);
  const args = ['new-session', '-d', '-s', name, '-x', '200', '-y', '50'];
  if (cwd) args.push('-c', cwd);
  args.push(command);
  tmux(config, args);
  return `已在 tmux 会话 ${name} 里启动：${command}`;
}

export function readSession(config: TmuxConfig, name: string, lines: number): string {
  if (!hasSession(config, name)) throw new Error(`tmux: 没有会话 ${name}（先 tmux_status 看看）`);
  return tmux(config, ['capture-pane', '-p', '-J', '-t', name, '-S', `-${Math.max(1, Math.min(lines, 2000))}`]);
}

export function sendKeys(config: TmuxConfig, name: string, text: string, enter: boolean): string {
  if (!hasSession(config, name)) throw new Error(`tmux: 没有会话 ${name}`);
  tmux(config, ['send-keys', '-t', name, '-l', text]);
  if (enter) tmux(config, ['send-keys', '-t', name, 'Enter']);
  return `已向 ${name} 发送${enter ? '并回车' : ''}：${text}`;
}

export function stopSession(config: TmuxConfig, name: string): string {
  if (!hasSession(config, name)) throw new Error(`tmux: 没有会话 ${name}`);
  tmux(config, ['kill-session', '-t', name]);
  return `已结束 ${name}`;
}
