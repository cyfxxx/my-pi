/**
 * bash 超时转后台的纯逻辑测试（编排优化第 2 项）
 *
 * 重点锁两件事：
 *   ① 超时判定要**准**（只认 pi 的 `timeout:<秒>` 形态，别把普通报错当超时乱转后台）；
 *   ② 转后台的命令**必须保留硬上限**——否则死循环会从"240s 被杀"变成"永远占着机器"。
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROMOTE_CEIL_S,
  parseTimeoutSeconds,
  promoteNotice,
  promoteSessionName,
  resolvePromoteCeil,
  wrapWithCeiling,
} from '../promote';

describe('parseTimeoutSeconds', () => {
  it('认得 pi 的超时文本（core/tools/bash.ts 抛 `timeout:<秒>`）', () => {
    expect(parseTimeoutSeconds('timeout:240')).toBe(240);
    expect(parseTimeoutSeconds('Error: timeout:240')).toBe(240);
    expect(parseTimeoutSeconds('some output\ntimeout:3600\n')).toBe(3600);
  });

  it('不把普通失败当超时（否则会乱转后台）', () => {
    expect(parseTimeoutSeconds('command not found')).toBeNull();
    expect(parseTimeoutSeconds('exit code 1')).toBeNull();
    expect(parseTimeoutSeconds('timeout')).toBeNull();
    expect(parseTimeoutSeconds('timeout:')).toBeNull();
    expect(parseTimeoutSeconds('timeout:0')).toBeNull();
    // 别的标识符里含 timeout: 不算（防误判成超时乱转后台）
    expect(parseTimeoutSeconds('mytimeout:240')).toBeNull();
    expect(parseTimeoutSeconds('')).toBeNull();
  });
});

describe('resolvePromoteCeil', () => {
  it('未配置/非法 → 默认 3600s；<=0 → 关闭（返回 0）', () => {
    expect(resolvePromoteCeil(undefined)).toBe(DEFAULT_PROMOTE_CEIL_S);
    expect(resolvePromoteCeil('')).toBe(DEFAULT_PROMOTE_CEIL_S);
    expect(resolvePromoteCeil('abc')).toBe(DEFAULT_PROMOTE_CEIL_S);
    expect(resolvePromoteCeil('1200')).toBe(1200);
    expect(resolvePromoteCeil('0')).toBe(0);
    expect(resolvePromoteCeil('-5')).toBe(0);
  });
});

describe('wrapWithCeiling', () => {
  it('包成 `timeout -k <宽限> <上限> sh -c <原命令>`（复合命令整体受限）', () => {
    expect(wrapWithCeiling('sleep 9999', 3600)).toBe("timeout -k 10 3600 sh -c 'sleep 9999'");
    // 管道/&&/重定向必须整体受同一个上限约束，而不是只管前半句
    expect(wrapWithCeiling('a | b && c > d', 60)).toBe("timeout -k 10 60 sh -c 'a | b && c > d'");
  });

  it('命令里的单引号被安全转义（不产生注入/截断）', () => {
    expect(wrapWithCeiling("echo 'hi'", 60)).toBe("timeout -k 10 60 sh -c 'echo '\\''hi'\\'''");
  });

  it('上限 <=0 时不加包装（显式关闭）', () => {
    expect(wrapWithCeiling('sleep 1', 0)).toBe('sleep 1');
    expect(wrapWithCeiling('sleep 1', -1)).toBe('sleep 1');
  });
});

describe('promoteSessionName / promoteNotice', () => {
  it('会话名稳定可预测（同一时刻同结果，可加前缀）', () => {
    expect(promoteSessionName(1_791_455_000_000)).toBe(promoteSessionName(1_791_455_000_000));
    expect(promoteSessionName(1_791_455_000_000)).toMatch(/^resume-[0-9a-z]+$/);
  });

  it('说明里必须给出会话名、日志路径与"会自动唤醒"，并说明可 tmux_stop', () => {
    const t = promoteNotice('pi-resume-x', '/tmp/log/x.log', 3600, 240);
    expect(t).toContain('pi-resume-x');
    expect(t).toContain('/tmp/log/x.log');
    expect(t).toContain('3600s 硬上限');
    expect(t).toContain('自动唤醒');
    expect(t).toContain('tmux_stop');
    expect(t).toContain('240s');
  });

  it('关闭上限时说明里要显式标注（不能让人以为仍有保护）', () => {
    expect(promoteNotice('pi-resume-x', '/tmp/x.log', 0, 240)).toContain('未加上限');
  });
});
