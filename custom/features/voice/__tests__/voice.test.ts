/**
 * voice 纯逻辑回归测试
 * 覆盖 TTS 文本清洗/调度、配置解析、服务确保（注入 deps，无网络/录音）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanForSpeech, isSpeechWorthy, createTtsDispatcher, extractAssistantText, selectTtsEngine } from '../tts/tts';
import { loadConfig, DEFAULTS, voiceScriptsDir } from '../config';
import { ensureWhisperService } from '../stt/transcription';
import { recorderSpec, convertToWav, deleteAudioPair, fileExists, waitForFileStable, cleanupStaleAudio } from '../audio/recording';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync, statSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('cleanForSpeech', () => {
  it('移除代码块/行内代码/链接/markdown 标记', () => {
    const md = '# 标题\n这是 `code` 与 [链接](http://x) 文本\n```js\nvar x=1\n```\n- 列表';
    const out = cleanForSpeech(md);
    expect(out).not.toContain('```');
    expect(out).not.toContain('http://x');
    expect(out).toContain('标题');
    expect(out).toContain('链接');
    expect(out).toContain('这是 code 与');
  });

  it('超长截断', () => {
    expect(cleanForSpeech('a'.repeat(500), 10)).toBe('aaaaaaaaaa...');
  });
});

describe('isSpeechWorthy', () => {
  it('短文本/JSON/纯符号不值得朗读', () => {
    expect(isSpeechWorthy('a')).toBe(false);
    expect(isSpeechWorthy('{"a":1}')).toBe(false);
    expect(isSpeechWorthy('[1,2]')).toBe(false);
    expect(isSpeechWorthy('***---')).toBe(false);
    expect(isSpeechWorthy('这是一段正常的话')).toBe(true);
  });
});

describe('selectTtsEngine', () => {
  const base = loadConfig({}, '/nonexistent/pi-voice.json');
  it('显式指定优先', () => {
    expect(selectTtsEngine({ ...base, ttsEngine: 'espeak' })).toBe('espeak');
    expect(selectTtsEngine({ ...base, ttsEngine: 'piper' })).toBe('piper');
  });

  it('auto：模型不存在回退 espeak，存在则 piper', () => {
    expect(selectTtsEngine({ ...base, ttsEngine: 'auto', linuxPiperModel: '/nonexistent/m.onnx' })).toBe('espeak');
    const dir = mkdtempSync(join(tmpdir(), 'my-pi-voice-'));
    const model = join(dir, 'm.onnx');
    writeFileSync(model, 'x');
    expect(selectTtsEngine({ ...base, ttsEngine: 'auto', linuxPiperModel: model })).toBe('piper');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('createTtsDispatcher', () => {
  it('合并待读为最新，串行执行', async () => {
    const spoken: string[] = [];
    const d = createTtsDispatcher({
      speakFn: async (t) => {
        spoken.push(t);
        await new Promise((r) => setTimeout(r, 5));
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    d.enqueue('一');
    d.enqueue('二');
    d.enqueue('三');
    expect(d.pendingCount()).toBeLessThanOrEqual(1);
    await d.flush();
    // 同步连发时中间文本被合并丢弃，只读最新
    expect(spoken).toContain('三');
    expect(spoken).not.toContain('二');
  });

  it('朗读失败经 onError 回调', async () => {
    const errors: string[] = [];
    const d = createTtsDispatcher({
      speakFn: async () => ({ code: 1, stdout: '', stderr: 'boom' }),
      onError: (m) => errors.push(m),
    });
    d.enqueue('x');
    await d.flush();
    expect(errors).toContain('boom');
  });
});

describe('extractAssistantText', () => {
  it('拼接 text block', () => {
    expect(extractAssistantText([{ type: 'text', text: 'a' }, { type: 'toolCall' }, { type: 'text', text: 'b' }])).toBe('a\nb');
    expect(extractAssistantText('plain')).toBe('plain');
    expect(extractAssistantText(undefined)).toBe('');
  });
});

describe('config', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ['PI_VOICE_LINUX_TTS_RATE', 'PI_VOICE_LANGUAGE', 'PI_VOICE_STT_BACKEND']) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('env 覆盖语言/后端', () => {
    process.env.PI_VOICE_LANGUAGE = 'en';
    process.env.PI_VOICE_STT_BACKEND = 'whisper';
    const c = loadConfig(process.env, '/nonexistent/pi-voice.json');
    expect(c.language).toBe('en');
    expect(c.sttBackend).toBe('whisper');
    expect(c.whisperEndpoint).toContain('http');
  });

  it('非法 ttsRate 抛校验错误', () => {
    process.env.PI_VOICE_LINUX_TTS_RATE = '10';
    expect(() => loadConfig(process.env, '/nonexistent/pi-voice.json')).toThrow('配置校验失败');
  });
});

describe('ensureWhisperService（注入 deps）', () => {
  it('健康直接通过', async () => {
    const r = await ensureWhisperService({} as never, { health: async () => true });
    expect(r.ok).toBe(true);
  });

  it('不健康→启动成功→轮询就绪', async () => {
    let healthy = false;
    const r = await ensureWhisperService({} as never, {
      health: async () => healthy,
      start: async () => {
        healthy = true;
        return { code: 0, stdout: '', stderr: '' };
      },
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
    });
    expect(r.ok).toBe(true);
  });

  it('启动失败→错误', async () => {
    const r = await ensureWhisperService({} as never, {
      health: async () => false,
      start: async () => ({ code: 1, stdout: '', stderr: 'no script' }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no script');
  });
});

describe('recording 平台规格与工具', () => {
  const base = loadConfig({}, '/nonexistent/pi-voice.json');
  it('termux spec: m4a + 需转码', () => {
    const spec = recorderSpec({ ...base, platform: 'termux' } as never);
    expect(spec.bin).toBe('termux-microphone-record');
    expect(spec.ext).toBe('m4a');
    expect(spec.needsConvert).toBe(true);
    expect(spec.startArgs('x.m4a')).toContain('-e');
    expect(spec.stopArgs()).toEqual(['-q']);
  });

  it('linux spec: wav 直出 + parec', () => {
    const spec = recorderSpec({ ...base, platform: 'linux' } as never);
    expect(spec.bin).toBe('parec');
    expect(spec.ext).toBe('wav');
    expect(spec.needsConvert).toBe(false);
    expect(spec.startArgs('x.wav').join(' ')).toContain('--format=s16le');
  });

  it('convertToWav linux 直接返回原文件', async () => {
    const r = await convertToWav({ ...base, platform: 'linux' } as never, '/tmp/a.wav');
    expect(r.wav).toBe('/tmp/a.wav');
    expect(r.error).toBe('');
  });

  it('fileExists / deleteAudioPair', () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-pi-voice-'));
    const f = join(dir, 'a.m4a');
    writeFileSync(f, 'x');
    expect(fileExists(f)).toBe(true);
    deleteAudioPair({} as never, f);
    expect(fileExists(f)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('waitForFileStable 稳定文件快速返回 true', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-pi-voice-'));
    const f = join(dir, 'a.wav');
    writeFileSync(f, 'x'.repeat(100));
    expect(await waitForFileStable(f, { pollMs: 5, stableSamples: 2, maxWaitMs: 500 })).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('cleanupStaleAudio 仅删过期文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-pi-voice-'));
    const old = join(dir, 'old.wav');
    const fresh = join(dir, 'new.wav');
    writeFileSync(old, 'x');
    writeFileSync(fresh, 'y');
    const past = new Date(Date.now() - 48 * 3600_000);
    utimesSync(old, past, past);
    const removed = cleanupStaleAudio({ tmpDir: dir } as never, 24 * 3600_000);
    expect(removed).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('diagnostics / wake', () => {
  const base = loadConfig({}, '/nonexistent/pi-voice.json');
  it('benchSuggestion 按 RTF 分档', async () => {
    const { benchSuggestion, platformInstallGuide } = await import('../diagnostics');
    expect(benchSuggestion(1.5)).toContain('更小模型');
    expect(benchSuggestion(0.7)).toContain('速度可接受');
    expect(benchSuggestion(0.1)).toContain('速度充裕');
    expect(platformInstallGuide({ ...base, platform: 'termux' } as never)).toContain('termux-api');
  });

  it('createWakeSession 非 linux 抛错', async () => {
    const { createWakeSession } = await import('../audio/wake');
    expect(() => createWakeSession({ ...base, platform: 'termux' } as never, { onHit: () => {}, onStatus: () => {} })).toThrow('仅支持 Linux');
  });

  it('windows recorder spec 使用 ffmpeg dshow', async () => {
    const { recorderSpec } = await import('../audio/recording');
    const spec = recorderSpec({ ...base, platform: 'windows', micDevice: '麦克风' } as never);
    expect(spec.bin).toBe('ffmpeg');
    expect(spec.ext).toBe('wav');
    expect(spec.startArgs('x.wav').join(' ')).toContain('-f dshow');
  });
});

describe('voice 服务脚本随仓库分发（回归：配置曾指向不存在的 portable/memory/voice/*）', () => {
  it('默认 whisperScript / sherpaScript 指向仓库内脚本且存在可执行', () => {
    expect(join(voiceScriptsDir(), 'pi-whisper.sh')).toBe(DEFAULTS.whisperScript);
    expect(join(voiceScriptsDir(), 'pi-sherpa.sh')).toBe(DEFAULTS.sherpaScript);
    for (const p of [DEFAULTS.whisperScript, DEFAULTS.sherpaScript]) {
      expect(existsSync(p), `${p} 应存在`).toBe(true);
      expect(constants.X_OK & statSync(p).mode, `${p} 应可执行`).toBeTruthy();
    }
  });

  it('服务端 python 与启动脚本同目录且存在', () => {
    const dir = voiceScriptsDir();
    for (const f of ['whisper-server.py', 'pi-sherpa-server.py']) {
      expect(existsSync(join(dir, f)), `${f} 应存在`).toBe(true);
    }
  });
});
