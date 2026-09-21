/**
 * voice dictation 状态机测试（注入 mock deps，无录音/网络依赖）
 */
import { describe, it, expect } from 'vitest';
import { createDictation } from '../dictation';
import type { RecordingDeps } from '../dictation';
import { loadConfig } from '../config';

const cfg = { ...loadConfig({}, '/nonexistent/pi-voice.json'), maxSeconds: 0, platform: 'linux' as const };

function makeDeps(over: Partial<RecordingDeps> & { text?: string; maxDb?: number; throwOnStart?: boolean } = {}): { deps: RecordingDeps; deleted: string[] } {
  const deleted: string[] = [];
  const deps: RecordingDeps = {
    startRecording: () => {
      if (over.throwOnStart) throw new Error('boom');
      return { child: { pid: 4321, exitCode: null, kill() {} } as never, file: '/tmp/a.m4a' };
    },
    stopRecording: async () => ({ code: 0, stdout: '', stderr: '' }),
    queryRecording: async () => ({ isRecording: true }),
    fileExists: () => true,
    convertToWav: async (_c, m) => ({ wav: m.replace(/\.m4a$/, '.wav'), error: '' }),
    transcribe: async () => ({ text: over.text ?? '你好世界', language: 'zh' }),
    deleteAudioPair: (_c, m) => deleted.push(m),
    waitForFileStable: async () => true,
    detectAudioLevel: async () => ({ maxDb: over.maxDb ?? -20, meanDb: -30 }),
    micLabel: 'parec',
    micInstallHint: 'apt install pulseaudio-utils',
    micPermissionHint: 'check mic permission',
    ...over,
  };
  return { deps, deleted };
}

describe('createDictation', () => {
  it('start → stop 转写并即用即弃删除音频', async () => {
    const { deps, deleted } = makeDeps();
    const d = createDictation(cfg, deps, { onAutoComplete: () => {} });
    expect(d.start()).toContain('录音中');
    expect(d.isRecording()).toBe(true);
    const r = await d.stop();
    expect(r.text).toBe('你好世界');
    expect(r.message).toContain('转写完成');
    expect(d.isRecording()).toBe(false);
    expect(deleted).toContain('/tmp/a.m4a');
  });

  it('空文本 + 低音量 → 提示未检测到声音', async () => {
    const { deps } = makeDeps({ text: '', maxDb: -50 });
    const d = createDictation(cfg, deps, { onAutoComplete: () => {} });
    d.start();
    const r = await d.stop();
    expect(r.text).toBe('');
    expect(r.message).toContain('未检测到声音');
  });

  it('cancel 删除文件并回到 idle', () => {
    const { deps, deleted } = makeDeps();
    const d = createDictation(cfg, deps, { onAutoComplete: () => {} });
    d.start();
    expect(d.cancel()).toBe('已取消');
    expect(d.isRecording()).toBe(false);
    expect(deleted).toContain('/tmp/a.m4a');
  });

  it('未录音时 stop → 提示未在录音', async () => {
    const { deps } = makeDeps();
    const d = createDictation(cfg, deps, { onAutoComplete: () => {} });
    const r = await d.stop();
    expect(r.message).toBe('未在录音');
    expect(r.busy).toBeUndefined();
  });

  it('start 抛错 → 返回启动失败', () => {
    const { deps } = makeDeps({ throwOnStart: true });
    const d = createDictation(cfg, deps, { onAutoComplete: () => {} });
    expect(d.start()).toContain('录音启动失败');
    expect(d.isRecording()).toBe(false);
  });
});
