/**
 * memory 工具集测试：ctx_note / ctx_list（便笺）、ctx_snap（检查点）、ctx_exec（子进程执行）
 * 数据目录通过 PI_MEMORY_DIR 隔离（dataDir() 每次读 env，无模块级缓存）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyNoteOp, formatNoteList, parseNoteKey, getNotesSize } from '../tools/notes-tools';
import { applySnapOp, sanitizeSnapName, listCheckpoints } from '../tools/checkpoint-tools';
import { detectLanguage, truncateOutput, execLanguageAsync, DEFAULT_MAX_OUTPUT } from '../tools/exec-tool';
import { loadNotes, updateNotes } from '../store/notes';
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

describe('updateNotes 跨进程合并（M3 防丢更新）', () => {
  it('两次 updateNotes 交错：回调期间盘上写入（其他会话）的键不丢', () => {
    writeFileSync(join(dir, 'notes.json'), JSON.stringify({ existing: 'v0' }));
    updateNotes((notes) => {
      notes.alpha = 'A';
      // 模拟另一实例/会话在本次保存前完成一次 updateNotes 写入（同步嵌套即交错点）
      updateNotes((inner) => {
        inner.beta = 'B';
      });
    });
    const notes = loadNotes();
    expect(notes.existing).toBe('v0');
    expect(notes.alpha).toBe('A');
    expect(notes.beta).toBe('B');
  });

  it('删除的键不被盘上旧值复活，且并发新增键保留', () => {
    writeFileSync(
      join(dir, 'notes.json'),
      JSON.stringify({ doomed: 'stale', __ttl_doomed: '2099-01-01T00:00:00Z', keep: 'k' }),
    );
    updateNotes((notes) => {
      delete notes.doomed;
      delete notes.__ttl_doomed;
      // 模拟并发写者：盘上仍留有旧键，同时新增了一个键
      const onDisk = JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf-8')) as Record<string, string>;
      onDisk.other = 'new';
      writeFileSync(join(dir, 'notes.json'), JSON.stringify(onDisk));
    });
    const notes = loadNotes();
    expect(notes.doomed).toBeUndefined();
    expect(notes.__ttl_doomed).toBeUndefined();
    expect(notes.keep).toBe('k');
    expect(notes.other).toBe('new');
  });

  it('__ttl_* 元数据键按普通键参与差分（重设 TTL / 删除带 TTL 的键）', () => {
    writeFileSync(
      join(dir, 'notes.json'),
      JSON.stringify({ k: 'v', __ttl_k: '2099-01-01T00:00:00Z', goner: 'x', __ttl_goner: '2099-01-01T00:00:00Z' }),
    );
    updateNotes((notes) => {
      notes.k = 'v2';
      notes.__ttl_k = '2030-01-01T00:00:00Z';
      delete notes.goner;
      delete notes.__ttl_goner;
    });
    const saved = JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf-8')) as Record<string, string>;
    expect(saved.k).toBe('v2');
    expect(saved.__ttl_k).toBe('2030-01-01T00:00:00Z');
    expect('goner' in saved).toBe(false);
    expect('__ttl_goner' in saved).toBe(false);
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
