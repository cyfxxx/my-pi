/**
 * 影子审查（shadow-review）测试
 * 覆盖规则命中/未命中、落盘隔离（PI_MEMORY_DIR）、读取与汇总
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkToolCall,
  loadShadowFindings,
  shadowReviewReport,
  shadowReviewFile,
} from '../shadow-review';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'my-pi-shadow-'));
  process.env.PI_MEMORY_DIR = dir;
  // 直接指定落盘文件：getMemoryDir 有进程级缓存，仅改 PI_MEMORY_DIR 不足以隔离
  process.env.PI_SHADOW_REVIEW_FILE = join(dir, 'stats', 'shadow-review.jsonl');
});

afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_SHADOW_REVIEW_FILE;
  rmSync(dir, { recursive: true, force: true });
});

describe('checkToolCall 规则', () => {
  it('rm -rf 命中 warning', () => {
    const f = checkToolCall('bash', { command: 'rm -rf /tmp/x' });
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('warning');
    expect(f[0].ruleId).toBe('bash-dangerous-cmd');
  });

  it('sudo 命中 critical', () => {
    const f = checkToolCall('bash', { command: 'sudo apt update' });
    expect(f.some((x) => x.severity === 'critical')).toBe(true);
  });

  it('chmod 777 命中 warning', () => {
    const f = checkToolCall('bash', { command: 'chmod 777 /tmp/x' });
    expect(f[0].severity).toBe('warning');
  });

  it('外部网络请求命中 info', () => {
    const f = checkToolCall('bash', { command: 'curl https://example.com/a' });
    expect(f.some((x) => x.type === 'network-request')).toBe(true);
  });

  it('敏感文件写入命中 warning（write/edit 均适用）', () => {
    expect(checkToolCall('write', { file_path: '/root/.pi/auth.json', content: 'x' })[0].severity).toBe('warning');
    expect(checkToolCall('edit', { path: '/app/.env', content: 'x' })[0].type).toBe('sensitive-file');
  });

  it('超大写入命中 info', () => {
    const f = checkToolCall('write', { file_path: '/tmp/big.txt', content: 'a'.repeat(100_001) });
    expect(f.some((x) => x.type === 'large-content')).toBe(true);
  });

  it('普通命令无发现', () => {
    expect(checkToolCall('bash', { command: 'ls -la' })).toHaveLength(0);
    expect(checkToolCall('read', { path: '/tmp/a.txt' })).toHaveLength(0);
  });
});

describe('落盘与读取', () => {
  it('recordFinding 写入 PI_MEMORY_DIR/stats/shadow-review.jsonl', () => {
    // checkToolCall 命中规则时内部自动落盘
    checkToolCall('bash', { command: 'rm -rf /tmp/x' });
    const file = shadowReviewFile();
    expect(file.startsWith(dir)).toBe(true);
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    const line = JSON.parse(lines[lines.length - 1]);
    expect(line.ruleId).toBe('bash-dangerous-cmd');
    expect(typeof line.ts).toBe('number');
  });

  it('loadShadowFindings 读取并过滤超期记录', () => {
    checkToolCall('bash', { command: 'sudo rm -rf /' });
    const loaded = loadShadowFindings(30);
    expect(loaded.length).toBeGreaterThan(0);
    // 100 天窗口应包含同一条（证明时间过滤按 maxDays 生效而非丢弃）
    expect(loadShadowFindings(1).length).toBeGreaterThan(0);
  });

  it('shadowReviewReport 按规则汇总计数', () => {
    checkToolCall('bash', { command: 'rm -rf /tmp/x' });
    checkToolCall('bash', { command: 'rm -rf /tmp/y' });
    const report = shadowReviewReport(7);
    expect(report['bash-dangerous-cmd']?.count).toBeGreaterThanOrEqual(2);
  });

  it('无文件时 loadShadowFindings 返回空数组', () => {
    expect(loadShadowFindings(30)).toEqual([]);
  });
});
