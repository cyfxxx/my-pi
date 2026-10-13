import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveOutput, archivedStub, archiveDir, sweepArchive } from '../budget/output-archive';
import { pruneToolOutput, resetOutputBudget, estimateTokens } from '../budget/budget';

const tmp = mkdtempSync(join(tmpdir(), 'my-pi-archive-'));
process.env.PI_OUTPUT_ARCHIVE_DIR = tmp;

/**
 * 「必定写不进去」的路径 —— 用于验证归档失败时的 fail-open。
 *
 * 为什么不能写 `/dev/null/ov-impossible`（原来的写法，2026-10-13 修）：
 *   `/dev/null` 是 **POSIX 专属**。Windows 上它不再是设备节点，而会被当成
 *   **相对当前盘根的普通路径**（Node 在 MSYS/git-bash 下解析 `/dev/null/x` →
 *   `<当前盘>:\dev\null\x`）。于是：
 *     ① 目录**真的被创建出来**，归档成功，测试断言 `toBeNull()` 失败；
 *     ② 在盘根留下 `\dev\null\...` 垃圾目录（实测在 M: 盘根留下一个）。
 *   项目里已有同样的跨平台教训：`scripts/net-mirror.mjs` 明确写了"不使用 /dev/null
 *   （POSIX 专属），一律写 os.tmpdir() 下的临时文件再删"。
 *
 * 改用"让路径穿过一个普通文件"：无论在 POSIX 还是 Windows，"在文件下面建目录"
 * 都是确定性失败（ENOTDIR / ENOENT），且不会在盘根留下任何东西。
 */
const blockingFile = join(tmp, 'blocking-file');
const impossibleDir = join(blockingFile, 'ov-impossible');

beforeAll(() => {
  process.env.PI_OUTPUT_ARCHIVE_DIR = tmp;
  writeFileSync(blockingFile, 'this is a file, not a directory');
});
afterAll(() => {
  delete process.env.PI_OUTPUT_ARCHIVE_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

describe('output-archive 工具输出归档', () => {
  it('归档返回路径且文件内容与原文一致', () => {
    const text = 'A'.repeat(5000);
    const path = archiveOutput(text);
    expect(path).toBeTruthy();
    expect(readFileSync(path!, 'utf-8')).toBe(text);
  });

  it('同内容重复归档 → 同路径（确定性）', () => {
    const text = 'B'.repeat(3000);
    expect(archiveOutput(text)).toBe(archiveOutput(text));
  });

  it('不同内容 → 不同路径', () => {
    const a = archiveOutput('content-alpha-'.repeat(200));
    const b = archiveOutput('content-beta-'.repeat(200));
    expect(a).not.toBe(b);
  });

  it('空文本返回 null', () => {
    expect(archiveOutput('')).toBeNull();
  });

  it('写盘失败 fail-open 返回 null', () => {
    const prev = process.env.PI_OUTPUT_ARCHIVE_DIR;
    process.env.PI_OUTPUT_ARCHIVE_DIR = impossibleDir;
    const r = archiveOutput('x'.repeat(100));
    process.env.PI_OUTPUT_ARCHIVE_DIR = prev;
    expect(r).toBeNull();
  });

  it('archivedStub 附存档路径；归档失败退化为纯说明', () => {
    const stub = archivedStub('y'.repeat(2000), '[t 输出已截断]');
    expect(stub).toContain('[t 输出已截断]');
    expect(stub).toMatch(/已存档: .+\.txt$/);
    const prev = process.env.PI_OUTPUT_ARCHIVE_DIR;
    process.env.PI_OUTPUT_ARCHIVE_DIR = impossibleDir;
    const fallback = archivedStub('z'.repeat(2000), '[t 输出已裁剪]');
    process.env.PI_OUTPUT_ARCHIVE_DIR = prev;
    expect(fallback).toBe('[t 输出已裁剪]');
    expect(existsSync(stub.match(/已存档: (.+\.txt)/)![1])).toBe(true);
  });

  it('pruneToolOutput 截断时占位符附存档路径（集成）', () => {
    const big = 'w'.repeat(60_000);
    const out = pruneToolOutput(big, 'bash');
    expect(out).toContain('输出已截断');
    expect(out).toMatch(/原文 \d+ 字符已存档: (.+\.txt)$/);
    const m = out.match(/已存档: (.+\.txt)$/)!;
    expect(readFileSync(m[1], 'utf-8')).toBe(big);
  });

  it('read 豁免会话输出预算：预算耗尽后仍能读回归档（可恢复性保证）', () => {
    resetOutputBudget();
    // 耗尽 20K 会话输出预算
    for (let i = 0; i < 6; i++) pruneToolOutput('b'.repeat(20_000), 'bash');
    const bashOut = pruneToolOutput('c'.repeat(20_000), 'bash');
    expect(bashOut).toContain('输出已截断');
    expect(estimateTokens(bashOut)).toBeLessThan(600); // 被压到 300 token 档

    // read 仍按单次上限放行（不受会话累计预算约束）
    const readText = 'x'.repeat(12_000); // ≈3000 token
    expect(pruneToolOutput(readText, 'read')).toBe(readText);
  });

  it('预算耗尽但单条输出未超限 → 提示“已归档”而非“已截断”（文案回归）', () => {
    resetOutputBudget();
    for (let i = 0; i < 6; i++) pruneToolOutput('b'.repeat(20_000), 'bash');
    const out = pruneToolOutput('tiny note', 'todo');
    expect(out).toContain('输出已归档');
    expect(out).not.toContain('输出已截断');
    expect(out).toContain('tiny note');
  });

  it('sweepArchive 按保留期清理过期归档（含子目录）', async () => {
    const dir = join(archiveDir(), 'zz');
    mkdirSync(dir, { recursive: true });
    const oldFile = join(dir, 'old.txt');
    const newFile = join(dir, 'new.txt');
    writeFileSync(oldFile, 'x'.repeat(200));
    writeFileSync(newFile, 'y'.repeat(200));
    const past = (Date.now() - 30 * 86_400_000) / 1000;
    utimesSync(oldFile, past, past);

    const stats = await sweepArchive({ retentionDays: 1 });
    expect(stats.scanned).toBeGreaterThanOrEqual(2);
    expect(stats.deletedByAge).toBeGreaterThanOrEqual(1);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
  });

  it('sweepArchive 总量超限时从最旧删起（retentionDays<0 只做容量回收）', async () => {
    const dir = join(archiveDir(), 'yy');
    mkdirSync(dir, { recursive: true });
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    writeFileSync(a, 'a'.repeat(2000));
    writeFileSync(b, 'b'.repeat(2000));
    const past = (Date.now() - 10 * 86_400_000) / 1000;
    utimesSync(a, past, past);

    const stats = await sweepArchive({ retentionDays: -1, maxTotalBytes: 3000 });
    expect(stats.deletedBySize).toBeGreaterThanOrEqual(1);
    expect(existsSync(a)).toBe(false); // 最旧的先删
  });
});
