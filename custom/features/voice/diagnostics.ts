/**
 * Voice Feature — 诊断 / 基准（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-voice/diagnostics.ts`（简化 doctor/install guide）。
 */

import type { VoiceConfig } from './config';
import { resolvePlatform, recorderSpec, startRecording, stopRecording, waitForFileStable, fileExists, convertToWav, deleteAudioPair } from './audio/recording';
import { runCommand } from './types';
import { transcribeByBackend } from './stt/transcription';

export function platformInstallGuide(cfg: VoiceConfig): string {
  const kind = resolvePlatform(cfg);
  if (kind === 'termux') {
    return '1) 录音：pkg install termux-api（需 Termux:API 应用 + 麦克风权限）\n2) 转码：pkg install ffmpeg\n3) 转写：bash custom/features/voice/scripts/pi-whisper.sh start';
  }
  if (kind === 'windows') {
    return '1) 录音：安装 ffmpeg（winget install ffmpeg）\n2) 麦克风：Windows 设置 → 隐私 → 麦克风\n3) 转写：bash custom/features/voice/scripts/pi-whisper.sh start';
  }
  return '1) 录音：apt-get install pulseaudio-utils（parec）或 alsa-utils（arecord）\n2) TTS：apt-get install espeak-ng（+ pulseaudio-utils）\n3) 转写：bash custom/features/voice/scripts/pi-whisper.sh start';
}

export function voiceGuideError(cfg: VoiceConfig, detail: string): string {
  return `语音功能不可用：${detail}\n修复指引：\n${platformInstallGuide(cfg)}`;
}

export async function doctor(cfg: VoiceConfig): Promise<string[]> {
  const kind = resolvePlatform(cfg);
  const spec = recorderSpec(cfg);
  const lines: string[] = [];

  const probe = spec.queryArgs();
  if (probe !== null) {
    const mic = await runCommand(spec.bin, probe, { timeoutMs: 10000 });
    if (mic.code === 127) lines.push(`✗ 录音命令 ${spec.bin} 缺失：${platformInstallGuide(cfg).split('\n')[0]}`);
    else if (/permission|record_audio/i.test(mic.stderr)) lines.push('✗ 麦克风权限未授予');
    else if (kind === 'windows' && !cfg.micDevice) lines.push('✗ 未配置 dshow 麦克风设备（micDevice）');
    else lines.push(`✓ 麦克风可用（${spec.bin}）`);
  } else {
    const ver = await runCommand(spec.bin, ['--version'], { timeoutMs: 10000 });
    if (ver.code === 127) lines.push(`✗ 录音命令 ${spec.bin} 缺失`);
    else if (kind === 'windows' && !cfg.micDevice) lines.push('✗ 未配置 dshow 麦克风设备（micDevice）');
    else lines.push(`✓ 录音命令可用（${spec.bin}）`);
  }

  if (spec.needsConvert) {
    const ff = await runCommand(cfg.ffmpegBin, ['-version'], { timeoutMs: 10000 });
    lines.push(ff.code === 0 ? '✓ ffmpeg 可用' : '✗ ffmpeg 缺失：请安装 ffmpeg');
  }

  for (const [label, endpoint, token] of [
    ['whisper', cfg.whisperEndpoint, cfg.whisperToken],
    ['sherpa', cfg.sherpaEndpoint, cfg.sherpaToken],
  ] as const) {
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${endpoint}/health`, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) lines.push(`✗ ${label} 服务鉴权失败（${res.status}）`);
      else {
        const data = (await res.json()) as { ok?: boolean; model?: string; device?: string };
        lines.push(data.ok ? `✓ ${label} 服务可用（模型 ${data.model ?? ''}${data.device ? `，${data.device}` : ''}）` : `✓ ${label} 服务运行中（加载中）`);
      }
    } catch {
      lines.push(`✗ ${label} 服务不可达（${endpoint}）`);
    }
  }

  const ttsCheck = await runCommand(kind === 'termux' ? 'termux-tts-speak' : 'espeak-ng', kind === 'termux' ? ['--help'] : ['--version'], { timeoutMs: 10000 });
  lines.push(ttsCheck.code === 127 ? '✗ TTS 命令缺失（espeak-ng / termux-tts-speak）' : `✓ TTS 命令可用（${kind === 'termux' ? 'termux-tts-speak' : 'espeak-ng'}）`);
  return lines;
}

export interface BenchResult {
  lines: string[];
  rtf: number | null;
}

export function benchSuggestion(rtf: number): string {
  if (rtf > 1) return '转写慢于实时语速，建议换更小模型（/voice model tiny）提升速度';
  if (rtf > 0.5) return '速度可接受；若追求准确率可尝试更大模型，若追求响应可换 tiny';
  return '速度充裕（快于实时 2 倍以上），可尝试更大模型提升准确率（/voice model small）';
}

export async function benchmark(cfg: VoiceConfig): Promise<BenchResult> {
  const t0 = Date.now();
  const rec = startRecording(cfg, () => {});
  const file = rec.file;
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (rec.child.exitCode !== null) {
        clearInterval(timer);
        resolve();
      }
    }, 200);
    setTimeout(() => {
      clearInterval(timer);
      resolve();
    }, 15000);
  });
  const recordedMs = Math.max(Date.now() - t0, 1);
  await stopRecording(cfg).catch(() => undefined);
  await waitForFileStable(file);
  if (!fileExists(file)) {
    deleteAudioPair(cfg, file);
    return { lines: ['✗ 基准测试失败：录音未生成文件'], rtf: null };
  }
  const { wav, error } = await convertToWav(cfg, file);
  if (!wav) {
    deleteAudioPair(cfg, file);
    return { lines: [`✗ 基准测试失败：转码失败（${error}）`], rtf: null };
  }
  const t1 = Date.now();
  const r = await transcribeByBackend(cfg, wav);
  const transcribeMs = Date.now() - t1;
  deleteAudioPair(cfg, file);
  if (r.error) return { lines: [`✗ 转写失败：${r.error}`], rtf: null };
  const audioSec = recordedMs / 1000;
  const rtf = transcribeMs / 1000 / audioSec;
  return {
    lines: [
      `后端：${cfg.sttBackend}`,
      `音频：${audioSec.toFixed(1)}s；转写耗时：${(transcribeMs / 1000).toFixed(1)}s`,
      `实时率 RTF：${rtf.toFixed(2)}（${rtf <= 1 ? '快于实时' : '慢于实时'}）`,
      `建议：${benchSuggestion(rtf)}`,
    ],
    rtf,
  };
}
