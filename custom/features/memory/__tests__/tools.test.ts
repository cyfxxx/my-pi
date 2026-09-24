/**
 * memory 工具集测试：ctx_note / ctx_list（便笺）、ctx_snap（检查点）、ctx_exec（子进程执行）
 * 数据目录通过 PI_MEMORY_DIR 隔离（dataDir() 每次读 env，无模块级缓存）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyNoteOp, formatNoteList, parseNoteKey, getNotesSize } from '../tools/notes-tools';
import { applySnapOp, sanitizeSnapName, listCheckpoints } from '../tools/checkpoint-tools';
import { detectLanguage, truncateOutput, execLanguageAsync, DEFAULT_MAX_OUTPUT } from '../tools/exec-tool';
import { loadNotes } from '../store/notes';
import { checkpointsDir } from '../store/storage';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'my-pi-ctx-tools-'));
  process.env.PI_MEMORY_DIR = dir;
  delete process.env.PI_MEMORY_NAMESPACE;
});

afterEach(() => {
  delete process.env.PI_MEMORY_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('ctx_note / ctx_list（便笺）', () => {
  it('parseNoteKey 解析 @ttl 后缀', () => {
    expect(parseNoteKey('task.current')).toEqual({ key: 'task.current' });
    expect(parseNoteKey('task.a@ttl=2030-01-01T00:00:00Z')).toEqual({
      key: 'task.a',
      ttl: '2030-01-01T00:00:00Z',
    });
  });

  it('写入后可读取，读取不存在的键给出提示', () => {
    expect(applyNoteOp('k1', 'v1')).toContain('Saved note "k1"');
    expect(applyNoteOp('k1')).toBe('v1');
    expect(applyNoteOp('nope')).toBe('(no note for "nope")');
  });

  it('value=null 删除便笺（不存在的键给出提示）', () => {
    applyNoteOp('k1', 'v1');
    expect(applyNoteOp('k1', null)).toContain('Deleted note "k1"');
    expect(applyNoteOp('k1', null)).toContain('no note "k1" to delete');
  });

  it('TTL 过期后被 loadNotes 过滤', () => {
    applyNoteOp('old@ttl=2000-01-01T00:00:00Z', 'gone');
    expect(loadNotes().old).toBeUndefined();
    applyNoteOp('fresh@ttl=2099-01-01T00:00:00Z', 'alive');
    expect(loadNotes().fresh).toBe('alive');
  });

  it('ctx_list 支持前缀过滤与 detail', () => {
    applyNoteOp('task.a', 'aaa');
    applyNoteOp('other.b', 'bbb');
    expect(formatNoteList(loadNotes())).toContain('Notes (2)');
    expect(formatNoteList(loadNotes(), 'task')).toContain('task.a');
    expect(formatNoteList(loadNotes(), 'task')).not.toContain('other.b');
    expect(formatNoteList(loadNotes(), undefined, true)).toContain('aaa');
    expect(formatNoteList({}, undefined)).toBe('(no notes)');
  });

  it('getNotesSize 排除内部键', () => {
    expect(getNotesSize({ a: '1234', __ttl_a: 'x', '_ctx.x': 'yy' })).toBe(4);
  });
});

describe('ctx_snap（检查点）', () => {
  it('sanitizeSnapName 拒绝非法名', () => {
    expect(sanitizeSnapName('before-refactor')).toBe('before-refactor');
    expect(sanitizeSnapName('../etc/passwd')).toBeNull();
    expect(sanitizeSnapName('a/b')).toBeNull();
    expect(sanitizeSnapName('')).toBeNull();
    expect(sanitizeSnapName('x'.repeat(81))).toBeNull();
  });

  it('保存 → 列表 → 恢复便笺集合', () => {
    applyNoteOp('n1', 'first');
    expect(applySnapOp('snap1').text).toContain('Saved checkpoint "snap1"');
    expect(existsSync(join(checkpointsDir(), 'snap1.json'))).toBe(true);

    applyNoteOp('n1', 'changed');
    applyNoteOp('n2', 'added');
    const restored = applySnapOp('restore:snap1');
    expect(restored.text).toContain('Restored checkpoint "snap1"');
    const notes = loadNotes();
    expect(notes.n1).toBe('first');
    expect(notes.n2).toBeUndefined();
  });

  it('list 列出检查点，恢复不存在的检查点报错', () => {
    applySnapOp('a1');
    expect(listCheckpoints()).toContain('a1');
    expect(listCheckpoints()).toContain('Checkpoints (');
    expect(applySnapOp('restore:missing').isError).toBe(true);
  });

  it('非法名称不落盘', () => {
    const res = applySnapOp('../bad');
    expect(res.isError).toBe(true);
    const cpDir = checkpointsDir();
    const files = existsSync(cpDir) ? readdirSync(cpDir) : [];
    expect(files).toHaveLength(0);
  });
});

describe('ctx_exec（子进程执行）', () => {
  it('detectLanguage 按 shebang 推断', () => {
    expect(detectLanguage('console.log(1)')).toBe('js');
    expect(detectLanguage('#!/usr/bin/env python3\nprint(1)')).toBe('python');
    expect(detectLanguage('#!/bin/bash\necho hi')).toBe('shell');
  });

  it('truncateOutput 按上限截断并标注', () => {
    expect(truncateOutput('abcdef', 3)).toContain('abc');
    expect(truncateOutput('abcdef', 3)).toContain('truncated: 6 chars → 3 chars');
    expect(truncateOutput('abc', Number.POSITIVE_INFINITY)).toBe('abc');
    expect(truncateOutput('abc', DEFAULT_MAX_OUTPUT)).toBe('abc');
  });

  it('执行 js 代码并回收 stdout', async () => {
    const res = await execLanguageAsync('js', 'console.log("hello-ctx")', 5000);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('hello-ctx');
  });

  it('非零退出携带 stderr', async () => {
    const res = await execLanguageAsync('js', 'process.exit(3)', 5000);
    expect(res.status).toBe(3);
  });

  it('不支持的语言返回错误', async () => {
    const res = await execLanguageAsync('ruby', 'puts 1', 1000);
    expect(res.error).toContain('Unsupported language');
  });

  it('超时被中止', async () => {
    const res = await execLanguageAsync('js', 'setTimeout(()=>{}, 10000)', 300);
    expect(res.error ?? res.status).toBeTruthy();
  });
});
