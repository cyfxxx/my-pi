/**
 * link 纯逻辑回归测试
 * 迁移自 pi-tools pi-link/tests 的核心语义（config/card/lanip/guards/active/outbox/link 纯函数）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isValidUserHost,
  validateCard,
  selectLanIPv4,
  looksLikeWsl,
  loadConfig,
  deviceAddresses,
  checkConcurrentAndDedup,
  markSendStart,
  markSendSuccess,
  markSendEnd,
  resetSendGuards,
  writeActive,
  readActive,
  isActive,
  appendOutbox,
  readOutbox,
  OUTBOX_MAX,
  withStateLock,
} from '../logic';
import { existsSync, readFileSync } from 'node:fs';
import { wrapTaskMessage, extractReply, shellSingleQuote, buildRemoteCommand } from '../protocol';
import type { DeviceConfig } from '../logic';

describe('isValidUserHost / validateCard', () => {
  it('拒绝 - 开头/空白/空', () => {
    expect(isValidUserHost('-oProxyCommand=x')).toBe(false);
    expect(isValidUserHost('a b')).toBe(false);
    expect(isValidUserHost('')).toBe(false);
    expect(isValidUserHost('100.1.2.3')).toBe(true);
  });

  it('validateCard 通过合法卡片，拒绝非法 host/user/port', () => {
    expect(validateCard({ name: 'phone', host: '1.2.3.4', user: 'u0', port: 22 }).ok).toBe(true);
    expect(validateCard({ name: 'phone', host: '-x', user: 'u0' }).ok).toBe(false);
    expect(validateCard({ name: 'phone', host: '1.2.3.4', user: '-x' }).ok).toBe(false);
    expect(validateCard({ name: 'phone', host: '1.2.3.4', user: 'u0', port: 99999 }).ok).toBe(false);
  });
});

describe('lanip', () => {
  it('selectLanIPv4 优先私网物理网卡，排除回环/link-local', () => {
    const picked = selectLanIPv4([
      { name: 'Radmin VPN', address: '26.1.2.3' },
      { name: 'wlan0', address: '192.168.1.5' },
      { name: 'lo', address: '127.0.0.1' },
      { name: 'eth0', address: '169.254.1.1' },
    ]);
    expect(picked).toBe('192.168.1.5');
  });

  it('looksLikeWsl 依据 /proc/version 与环境变量', () => {
    expect(looksLikeWsl('Linux version ... microsoft-standard', {})).toBe(true);
    expect(looksLikeWsl('Linux 6.1', { WSL_DISTRO_NAME: 'Ubuntu' })).toBe(true);
    expect(looksLikeWsl('Linux 6.1', {})).toBe(false);
  });
});

describe('config 加载校验', () => {
  let dir: string;
  let cfgPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'my-pi-link-'));
    cfgPath = join(dir, 'pi-link.json');
    process.env.PI_LINK_CONFIG = cfgPath;
  });
  afterEach(() => {
    delete process.env.PI_LINK_CONFIG;
    rmSync(dir, { recursive: true, force: true });
  });

  it('非法 host/user 设备整台跳过，合法保留', () => {
    writeFileSync(
      cfgPath,
      JSON.stringify({
        devices: {
          good: { host: '1.2.3.4', user: 'u0' },
          badHost: { host: '-x', user: 'u0' },
          badUser: { host: '1.2.3.5', user: '-oProxyCommand' },
        },
      }),
    );
    const cfg = loadConfig(cfgPath);
    expect(Object.keys(cfg.devices)).toEqual(['good']);
    expect(deviceAddresses({ host: 'a', user: 'u', port: 22, altHosts: [{ host: 'b' }] })).toEqual([
      { host: 'a', port: 22 },
      { host: 'b' },
    ]);
  });
});

describe('guards: 并发与去重', () => {
  beforeEach(() => resetSendGuards());

  it('in-flight 拒绝；去重窗口内同消息拒绝；成功后去重', () => {
    expect(checkConcurrentAndDedup('d1', 'hi').ok).toBe(true);
    markSendStart('d1');
    expect(checkConcurrentAndDedup('d1', 'hi').ok).toBe(false);
    markSendEnd('d1');
    markSendSuccess('d1', 'hi');
    expect(checkConcurrentAndDedup('d1', 'hi').ok).toBe(false);
    expect(checkConcurrentAndDedup('d1', 'other').ok).toBe(true);
  });
});

describe('active / outbox 文件语义', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'my-pi-link-state-'));
    process.env.PI_LINK_STATE_DIR = dir;
  });
  afterEach(() => {
    delete process.env.PI_LINK_STATE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('活跃窗口判定', () => {
    writeActive({ device: 'me', lastActiveAt: Date.now() });
    expect(isActive(readActive())).toBe(true);
    expect(isActive({ device: 'me', lastActiveAt: Date.now() - 60 * 60 * 1000 })).toBe(false);
  });

  it('outbox 环形缓冲上限', () => {
    for (let i = 0; i < OUTBOX_MAX + 5; i++) appendOutbox('me', `m${i}`);
    const entries = readOutbox();
    expect(entries).toHaveLength(OUTBOX_MAX);
    expect(entries[entries.length - 1].text).toBe(`m${OUTBOX_MAX + 4}`);
  });
});

describe('link.ts 纯函数', () => {
  it('wrapTaskMessage 含指令模板与发起设备', () => {
    const msg = wrapTaskMessage('做事', 'laptop');
    expect(msg).toContain('[远程执行任务]');
    expect(msg).toContain('发起设备: laptop');
    expect(msg).toContain('做事');
  });

  it('extractReply 取最后 assistant 文本', () => {
    const { text, model } = extractReply([
      { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'one' }] } },
      { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'final' }], model: 'm1' } },
    ]);
    expect(text).toBe('final');
    expect(model).toBe('m1');
  });

  it('shellSingleQuote 转义单引号', () => {
    expect(shellSingleQuote("a'b")).toBe(`'a'\\''b'`);
  });

  it('buildRemoteCommand 含 rpc/no-extensions/单引号 session-dir', () => {
    const d: DeviceConfig = { host: 'h', user: 'u' };
    const cmd = buildRemoteCommand(d, {});
    expect(cmd).toContain('--mode rpc');
    expect(cmd).toContain('--no-extensions');
    expect(cmd).toContain('--session-dir');
    expect(cmd).toContain("'~/.pi/agent/sessions/pi-link'");
    expect(cmd).toContain('exec pi');
  });

  it('buildRemoteCommand：extensions=true 时不加 --no-extensions', () => {
    const cmd = buildRemoteCommand({ host: 'h', user: 'u' }, { extensions: true, sessionPolicy: 'fresh' });
    expect(cmd).not.toContain('--no-extensions');
    expect(cmd).not.toContain('PI_LINK_LAST_SESSION');
  });
});

describe('withStateLock', () => {
  it('正常加锁执行并释放', () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-pi-lock-'));
    const file = join(dir, 'state.json');
    const r = withStateLock(file, () => 42);
    expect(r).toBe(42);
    expect(existsSync(`${file}.lock`)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('过期锁（时间戳超时）可被抢占', () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-pi-lock-'));
    const file = join(dir, 'state.json');
    writeFileSync(`${file}.lock`, JSON.stringify({ pid: process.pid, ts: Date.now() - 60_000 }));
    const r = withStateLock(file, () => 'ok');
    expect(r).toBe('ok');
    expect(existsSync(`${file}.lock`)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('他人持有的“活锁”超时后不被删除，仅降级无锁执行', () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-pi-lock-'));
    const file = join(dir, 'state.json');
    writeFileSync(`${file}.lock`, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    const r = withStateLock(file, () => 'ran');
    expect(r).toBe('ran');
    // 未持有锁：不得删除他人锁文件
    expect(existsSync(`${file}.lock`)).toBe(true);
    expect(JSON.parse(readFileSync(`${file}.lock`, 'utf-8')).pid).toBe(process.pid);
    rmSync(dir, { recursive: true, force: true });
  }, 10000);
});

describe('link: extractFinalReply 兼容 string 与 blocks', () => {
  it('字符串 content 的 assistant 消息也能提取', async () => {
    const { extractFinalReply } = await import('../logic');
    const msgs = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '纯字符串回复' },
    ];
    expect(extractFinalReply(msgs)).toBe('纯字符串回复');
  });

  it('blocks 形态取最后一条非空 assistant 文本', async () => {
    const { extractFinalReply } = await import('../logic');
    const msgs = [
      { role: 'assistant', content: [{ type: 'text', text: '第一' }] },
      { role: 'user', content: 'x' },
      { role: 'assistant', content: [{ type: 'text', text: '  第二  ' }] },
    ];
    expect(extractFinalReply(msgs)).toBe('第二');
  });
});
