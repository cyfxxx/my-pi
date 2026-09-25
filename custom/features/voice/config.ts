/**
 * Voice Feature — 配置加载/持久化（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-voice/config.ts`（平台/录音字段保留默认）。
 * 读取顺序：环境变量 > portable/agent/pi-voice.json > 默认值。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAgentDir, getMemoryDir, getProjectRoot } from '../../core/config';

export type PlatformKind = 'auto' | 'termux' | 'linux' | 'windows';
export type TtsEngine = 'auto' | 'piper' | 'espeak';

export interface VoiceConfig {
  whisperEndpoint: string;
  whisperToken: string;
  platform: PlatformKind;
  micBin: string;
  micDevice: string;
  ffmpegBin: string;
  ttsBin: string;
  linuxMicDevice: string;
  linuxTtsSink: string;
  ttsEngine: TtsEngine;
  linuxPiperModel: string;
  linuxTtsVoice: string;
  linuxTtsRate: number;
  tmpDir: string;
  audioDir: string;
  ttsEnabled: boolean;
  ttsMaxChars: number;
  autoSend: boolean;
  maxSeconds: number;
  language: string;
  whisperModel: string;
  whisperDevice: 'auto' | 'cpu' | 'cuda';
  whisperScript: string;
  sttBackend: 'whisper' | 'sherpa';
  autoWake: boolean;
  sherpaEndpoint: string;
  sherpaToken: string;
  sherpaScript: string;
}

export function defaultTmpDir(): string {
  if (existsSync('/storage/emulated/0')) {
    try {
      const dir = '/storage/emulated/0/pi-voice/';
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      /* 回退 */
    }
  }
  return join(tmpdir(), 'my-pi-voice');
}

export function configPath(): string {
  return process.env.PI_VOICE_CONFIG || join(getAgentDir(), 'pi-voice.json');
}

/**
 * 语音服务脚本目录（随仓库分发）。
 *
 * 迁移 note：pi-tools 把脚本放在扩展目录、默认路径指向 `~/.pi/scripts/`（需 rebuild 安装）。
 * my-pi 直接指向仓库内 `custom/features/voice/scripts/`，fresh checkout 即可用；
 * 运行数据（日志/pid）仍收敛到 `portable/memory/logs/voice/`。
 */
export function voiceScriptsDir(): string {
  return join(getProjectRoot(), 'custom', 'features', 'voice', 'scripts');
}

export const DEFAULTS: VoiceConfig = {
  whisperEndpoint: 'http://127.0.0.1:18766',
  whisperToken: '',
  platform: 'auto',
  micBin: 'termux-microphone-record',
  micDevice: '',
  ffmpegBin: 'ffmpeg',
  ttsBin: 'termux-tts-speak',
  linuxMicDevice: '',
  linuxTtsSink: '',
  ttsEngine: 'auto',
  linuxPiperModel: '/opt/pi-tts/models/zh_CN-huayan-medium.onnx',
  linuxTtsVoice: 'cmn',
  linuxTtsRate: 170,
  tmpDir: defaultTmpDir(),
  audioDir: join(getMemoryDir(), 'voice'),
  ttsEnabled: false,
  ttsMaxChars: 400,
  autoSend: false,
  maxSeconds: 120,
  language: '',
  whisperModel: 'base',
  whisperDevice: 'auto',
  whisperScript: join(voiceScriptsDir(), 'pi-whisper.sh'),
  sttBackend: 'whisper',
  autoWake: false,
  sherpaEndpoint: 'http://127.0.0.1:18768',
  sherpaToken: '',
  sherpaScript: join(voiceScriptsDir(), 'pi-sherpa.sh'),
};

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, path: string = configPath()): VoiceConfig {
  let file: Partial<VoiceConfig> = {};
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, 'utf-8')) as Partial<VoiceConfig>;
    } catch {
      /* 回退默认 */
    }
  }
  const numeric = (v: string | undefined, fallback: number): number => {
    const n = Number(v);
    return v === undefined || !Number.isFinite(n) ? fallback : n;
  };
  const merged: VoiceConfig = {
    whisperEndpoint: env.PI_VOICE_WHISPER_ENDPOINT || file.whisperEndpoint || DEFAULTS.whisperEndpoint,
    whisperToken: env.PI_VOICE_WHISPER_TOKEN || file.whisperToken || DEFAULTS.whisperToken,
    platform: (env.PI_VOICE_PLATFORM ?? file.platform ?? DEFAULTS.platform) as PlatformKind,
    micBin: env.PI_VOICE_MIC_BIN || file.micBin || DEFAULTS.micBin,
    micDevice: env.PI_VOICE_MIC_DEVICE ?? file.micDevice ?? DEFAULTS.micDevice,
    ffmpegBin: env.PI_VOICE_FFMPEG_BIN || file.ffmpegBin || DEFAULTS.ffmpegBin,
    ttsBin: env.PI_VOICE_TTS_BIN || file.ttsBin || DEFAULTS.ttsBin,
    linuxMicDevice: env.PI_VOICE_LINUX_MIC_DEVICE ?? file.linuxMicDevice ?? DEFAULTS.linuxMicDevice,
    linuxTtsSink: env.PI_VOICE_LINUX_TTS_SINK ?? file.linuxTtsSink ?? DEFAULTS.linuxTtsSink,
    ttsEngine: (env.PI_VOICE_TTS_ENGINE ?? file.ttsEngine ?? DEFAULTS.ttsEngine) as TtsEngine,
    linuxPiperModel: env.PI_VOICE_PIPER_MODEL ?? file.linuxPiperModel ?? DEFAULTS.linuxPiperModel,
    linuxTtsVoice: env.PI_VOICE_LINUX_TTS_VOICE ?? file.linuxTtsVoice ?? DEFAULTS.linuxTtsVoice,
    linuxTtsRate: numeric(env.PI_VOICE_LINUX_TTS_RATE, file.linuxTtsRate ?? DEFAULTS.linuxTtsRate),
    tmpDir: env.PI_VOICE_TMP_DIR || file.tmpDir || DEFAULTS.tmpDir,
    audioDir: file.audioDir || DEFAULTS.audioDir,
    ttsEnabled: envBool(env.PI_VOICE_TTS_ENABLED, file.ttsEnabled ?? DEFAULTS.ttsEnabled),
    ttsMaxChars: numeric(env.PI_VOICE_TTS_MAX_CHARS, file.ttsMaxChars ?? DEFAULTS.ttsMaxChars),
    autoSend: envBool(env.PI_VOICE_AUTO_SEND, file.autoSend ?? DEFAULTS.autoSend),
    maxSeconds: numeric(env.PI_VOICE_MAX_SECONDS, file.maxSeconds ?? DEFAULTS.maxSeconds),
    language: env.PI_VOICE_LANGUAGE ?? file.language ?? DEFAULTS.language,
    whisperModel: env.PI_VOICE_WHISPER_MODEL ?? file.whisperModel ?? DEFAULTS.whisperModel,
    whisperDevice: (env.PI_VOICE_WHISPER_DEVICE ?? file.whisperDevice ?? DEFAULTS.whisperDevice) as VoiceConfig['whisperDevice'],
    whisperScript: env.PI_VOICE_WHISPER_SCRIPT ?? file.whisperScript ?? DEFAULTS.whisperScript,
    sttBackend: (env.PI_VOICE_STT_BACKEND ?? file.sttBackend ?? DEFAULTS.sttBackend) as VoiceConfig['sttBackend'],
    autoWake: envBool(env.PI_VOICE_AUTO_WAKE, file.autoWake ?? DEFAULTS.autoWake),
    sherpaEndpoint: env.PI_VOICE_SHERPA_ENDPOINT ?? file.sherpaEndpoint ?? DEFAULTS.sherpaEndpoint,
    sherpaToken: env.PI_VOICE_SHERPA_TOKEN ?? file.sherpaToken ?? file.whisperToken ?? DEFAULTS.sherpaToken,
    sherpaScript: env.PI_VOICE_SHERPA_SCRIPT ?? file.sherpaScript ?? DEFAULTS.sherpaScript,
  };
  validateConfig(merged);
  return merged;
}

function validateConfig(cfg: VoiceConfig): void {
  const errors: string[] = [];
  if (!cfg.whisperEndpoint || typeof cfg.whisperEndpoint !== 'string') errors.push('whisperEndpoint 为空或非法');
  if (cfg.sttBackend === 'sherpa' && (!cfg.sherpaEndpoint || typeof cfg.sherpaEndpoint !== 'string')) {
    errors.push('sherpaEndpoint 为空（sttBackend=sherpa 时必填）');
  }
  if (typeof cfg.tmpDir !== 'string' || !cfg.tmpDir) errors.push('tmpDir 为空');
  if (!Number.isFinite(cfg.maxSeconds) || cfg.maxSeconds < 0) errors.push('maxSeconds 必须 ≥ 0');
  if (!Number.isFinite(cfg.linuxTtsRate) || cfg.linuxTtsRate < 50 || cfg.linuxTtsRate > 500) errors.push('linuxTtsRate 必须在 50-500');
  if (!Number.isFinite(cfg.ttsMaxChars) || cfg.ttsMaxChars < 1) errors.push('ttsMaxChars 必须 ≥ 1');
  if (!['auto', 'cpu', 'cuda'].includes(cfg.whisperDevice)) errors.push('whisperDevice 必须为 auto/cpu/cuda');
  if (!['whisper', 'sherpa'].includes(cfg.sttBackend)) errors.push('sttBackend 必须为 whisper/sherpa');
  if (errors.length > 0) throw new Error(`voice 配置校验失败：${errors.join('；')}`);
}

const ENV_KEY_OF: Partial<Record<keyof VoiceConfig, string>> = {
  whisperEndpoint: 'PI_VOICE_WHISPER_ENDPOINT',
  whisperToken: 'PI_VOICE_WHISPER_TOKEN',
  platform: 'PI_VOICE_PLATFORM',
  ttsEnabled: 'PI_VOICE_TTS_ENABLED',
  ttsMaxChars: 'PI_VOICE_TTS_MAX_CHARS',
  autoSend: 'PI_VOICE_AUTO_SEND',
  maxSeconds: 'PI_VOICE_MAX_SECONDS',
  language: 'PI_VOICE_LANGUAGE',
  whisperModel: 'PI_VOICE_WHISPER_MODEL',
  whisperDevice: 'PI_VOICE_WHISPER_DEVICE',
  sttBackend: 'PI_VOICE_STT_BACKEND',
  autoWake: 'PI_VOICE_AUTO_WAKE',
};

/** 持久化非环境变量覆盖的字段到 pi-voice.json，返回落盘字段名 */
export function persistConfig(partial: Partial<VoiceConfig>, env: NodeJS.ProcessEnv = process.env): string[] {
  const path = configPath();
  let file: Partial<VoiceConfig> = {};
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, 'utf-8')) as Partial<VoiceConfig>;
    } catch {
      /* 覆盖损坏文件 */
    }
  }
  const written: string[] = [];
  for (const [key, value] of Object.entries(partial) as Array<[keyof VoiceConfig, unknown]>) {
    if (value === undefined) continue;
    const envName = ENV_KEY_OF[key];
    if (envName && env[envName] !== undefined) continue;
    (file as Record<string, unknown>)[key] = value;
    written.push(key);
  }
  try {
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
  } catch (e) {
    throw new Error(`写入配置失败: ${(e as Error).message}`);
  }
  return written;
}
