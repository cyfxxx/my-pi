import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadNotes, saveNotes, updateNotes, notesFile } from '../note-store';

const tmp = mkdtempSync(join(tmpdir(), 'my-pi-notes-'));

beforeAll(() => { process.env.PI_MEMORY_DIR = tmp; });
afterAll(() => {
  delete process.env.PI_MEMORY_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

describe('note-store', () => {
  it('updateNotes 原地改后落盘，loadNotes 读回', () => {
    updateNotes(notes => { notes.foo = 'bar'; });
    expect(loadNotes().foo).toBe('bar');
  });

  it('saveNotes 写时脱敏', () => {
    saveNotes({ token: 'sk-abcdefghijklmnop1234' });
    expect(loadNotes().token).toContain('[REDACTED');
  });

  it('损坏文件备份后空启动', () => {
    const before = readdirSync(tmp).length;
    writeFileSync(notesFile(), '{ not json');
    expect(loadNotes()).toEqual({});
    const after = readdirSync(tmp);
    expect(after.some(f => f.includes('.corrupt-'))).toBe(true);
    expect(after.length).toBeGreaterThanOrEqual(before);
  });
});
