/**
 * Voice Feature — 录音/转写状态机（纯逻辑，零 Pi 依赖）
 * 迁移自 pi-tools `agent/extensions/pi-voice/dictation.ts`。
 * 生命周期：idle → recording → transcribing → idle；依赖注入便于单测。
 */

import type { ChildProcess } from 'node:child_process';
import type { VoiceConfig } from '../config';
import type { CommandResult, TranscribeResult } from '../types';

export interface RecordingDeps {
  startRecording(cfg: VoiceConfig, onExit: (code: number, stderr?: string) => void, opts?: { forceClean?: boolean }): { child: ChildProcess; file: string };
  stopRecording(cfg: VoiceConfig): Promise<CommandResult>;
  queryRecording(cfg: VoiceConfig): Promise<{ isRecording: boolean } | null>;
  fileExists(m4a: string): boolean;
  convertToWav(cfg: VoiceConfig, m4a: string): Promise<{ wav: string | null; error: string }>;
  transcribe(cfg: VoiceConfig, wav: string): Promise<TranscribeResult>;
  deleteAudioPair(cfg: VoiceConfig, m4a: string): void;
  waitForFileStable(m4a: string, opts?: { pollMs?: number; stableSamples?: number; maxWaitMs?: number }): Promise<boolean>;
  detectAudioLevel(wav: string): Promise<{ maxDb: number; meanDb: number } | null>;
  micLabel: string;
  micInstallHint: string;
  micPermissionHint: string;
}

export interface StopResult {
  message: string;
  text: string;
  language: string;
  autoReason?: 'timer' | 'exit';
  autoSec?: number;
  busy?: boolean;
}

export interface DictationCallbacks {
  onAutoComplete(result: StopResult): void;
  onReady?(): void;
}

export interface Dictation {
  start(): string;
  stop(): Promise<StopResult>;
  cancel(): string;
  cleanup(): void;
  isRecording(): boolean;
  isTranscribing(): boolean;
}

async function convertWithRetry(deps: RecordingDeps, cfg: VoiceConfig, m4a: string): Promise<{ wav: string | null; error: string }> {
  let error = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await deps.convertToWav(cfg, m4a);
    if (r.wav) return { wav: r.wav, error: '' };
    error = r.error;
    if (attempt < 2) await new Promise((r2) => setTimeout(r2, 1000));
  }
  return { wav: null, error };
}

export function createDictation(cfg: VoiceConfig, deps: RecordingDeps, cb: DictationCallbacks): Dictation {
  let currentFile: string | null = null;
  let stopping = false;
  let recordingChild: ChildProcess | null = null;
  let busy = false;
  let gen = 0;
  let retried = false;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function isRecording(): boolean {
    return currentFile !== null;
  }
  function isTranscribing(): boolean {
    return busy;
  }

  function spawnRecorder(expectGen: number, forceClean = false): { child: ChildProcess; file: string } | null {
    startedAt = Date.now();
    const { child, file } = deps.startRecording(
      cfg,
      (code, _detail) => {
        if (currentFile !== file || busy) return;
        if (code === 0) {
          void (async () => {
            const info = await deps.queryRecording(cfg);
            if (expectGen !== gen || currentFile !== file || busy) return;
            const stillRecording = info?.isRecording === true && deps.fileExists(file);
            if (stillRecording) {
              recordingChild = null;
              return;
            }
            currentFile = null;
            recordingChild = null;
            stopping = true;
            try {
              await deps.stopRecording(cfg).catch(() => undefined);
              const stable = await deps.waitForFileStable(file, { maxWaitMs: 5000 });
              if (expectGen !== gen) return;
              if (stable) {
                const actualSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
                cb.onAutoComplete(await finish(file, 'exit', actualSec));
              } else if (!retried) {
                retried = true;
                await new Promise((r2) => { const x = setTimeout(r2, 3000); x.unref?.(); });
                if (expectGen !== gen || currentFile !== null || busy) return;
                spawnRecorder(expectGen, true);
              } else {
                cb.onAutoComplete({ message: '录音启动失败：录音进程已退出且未生成音频，请检查麦克风权限或先停止现有录音', text: '', language: '' });
              }
            } finally {
              stopping = false;
            }
          })().catch((e) => console.warn('[voice] 录音退出处理失败:', (e as Error)?.message ?? e));
        } else {
          currentFile = null;
          recordingChild = null;
          const reason = code === -2 ? `无法启动录音程序（${deps.micLabel} 缺失或不可执行）` : `录音进程异常退出（code ${code}）`;
          cb.onAutoComplete({ message: `录音启动失败：${reason}。检查：1) ${deps.micPermissionHint} 2) ${deps.micInstallHint}`, text: '', language: '' });
        }
      },
      { forceClean },
    );
    if (child.pid === undefined) return null;
    currentFile = file;
    recordingChild = child;
    const verifyTimer = setTimeout(() => {
      if (expectGen !== gen || currentFile !== file) return;
      if (recordingChild === null || recordingChild.exitCode != null) return;
      if (deps.fileExists(file)) return;
      void (async () => {
        if (recordingChild === null || recordingChild.exitCode != null || deps.fileExists(file)) return;
        currentFile = null;
        recordingChild = null;
        stopping = true;
        try {
          await deps.stopRecording(cfg).catch(() => undefined);
          if (expectGen !== gen) return;
          if (!retried) {
            retried = true;
            await new Promise((r) => { const x = setTimeout(r, 3000); x.unref?.(); });
            if (expectGen !== gen || currentFile !== null || busy) return;
            spawnRecorder(expectGen, true);
            return;
          }
          cb.onAutoComplete({ message: '录音启动失败：服务端未实际开始录音（无音频文件），已自动重试仍失败', text: '', language: '' });
        } finally {
          stopping = false;
        }
      })();
    }, 8000);
    verifyTimer.unref?.();
    return { child, file };
  }

  function start(): string {
    if (busy) return '上一段仍在转写中，请稍候';
    if (stopping) return '正在停止上一段录音，请稍候再试';
    if (currentFile !== null) return '已在录音中（再次 Ctrl+Alt+R 停止）';
    gen += 1;
    retried = false;
    let r: { child: ChildProcess; file: string } | null = null;
    try {
      r = spawnRecorder(gen);
    } catch (e) {
      gen -= 1;
      return `录音启动失败：${(e as Error)?.message ?? String(e)}`;
    }
    if (!r) return `录音启动失败（请确认已安装：${deps.micInstallHint}）`;
    clearTimer();
    if (cfg.maxSeconds > 0) {
      const t = setTimeout(() => {
        timer = null;
        void stopInternal(true)
          .then((res) => {
            if (res) cb.onAutoComplete(res);
          })
          .catch((e) => console.warn('[voice] 定时器自动停止失败:', (e as Error)?.message ?? e));
      }, cfg.maxSeconds * 1000);
      t.unref?.();
      timer = t;
    }
    let readyPoll: ReturnType<typeof setInterval> | null = null;
    readyPoll = setInterval(() => {
      if (currentFile !== r.file) {
        if (readyPoll) {
          clearInterval(readyPoll);
          readyPoll = null;
        }
        return;
      }
      if (deps.fileExists(r.file)) {
        if (readyPoll) {
          clearInterval(readyPoll);
          readyPoll = null;
        }
        cb.onReady?.();
      }
    }, 300);
    readyPoll.unref?.();
    return `🎤 录音中（再次 Ctrl+Alt+R 停止并转写；上限 ${cfg.maxSeconds > 0 ? `${cfg.maxSeconds}s` : '不限'}）`;
  }

  async function stopInternal(auto: boolean): Promise<StopResult | null> {
    if (busy) return null;
    if (currentFile === null) return null;
    stopping = true;
    clearTimer();
    const file = currentFile;
    currentFile = null;
    recordingChild = null;
    await deps.stopRecording(cfg).catch(() => undefined);
    try {
      return await finish(file, auto ? 'timer' : 'manual', Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    } finally {
      stopping = false;
    }
  }

  function stop(): Promise<StopResult> {
    return stopInternal(false).then(
      (r) => r ?? { message: busy ? '正在转写，请稍候' : '未在录音', text: '', language: '', busy: busy || undefined },
    );
  }

  function cancel(): string {
    if (currentFile === null) return '未在录音';
    gen += 1;
    clearTimer();
    const file = currentFile;
    currentFile = null;
    recordingChild = null;
    stopping = true;
    void deps
      .stopRecording(cfg)
      .catch(() => undefined)
      .finally(() => {
        stopping = false;
      });
    deps.deleteAudioPair(cfg, file);
    return '已取消';
  }

  async function finish(file: string, reason: 'manual' | 'timer' | 'exit', actualSec?: number): Promise<StopResult> {
    busy = true;
    try {
      const prefix = reason === 'timer' ? '录音时长到上限，自动开始转写：' : reason === 'exit' ? `录音异常提前结束（${actualSec ?? '?'}s），自动转写：` : '';
      const autoReason = reason === 'manual' ? undefined : reason;
      const autoSec = reason === 'exit' ? actualSec : undefined;
      const stable = await deps.waitForFileStable(file);
      if (!stable) {
        const msg = reason === 'manual' ? '未生成录音文件：服务端未实际开始录音，请重试' : `${prefix}录音文件未生成或未写入完成`;
        return { message: msg, text: '', language: '', autoReason };
      }
      const { wav, error } = await convertWithRetry(deps, cfg, file);
      if (!wav) {
        const detail = error ? `（${error}）` : '';
        return { message: `${prefix}m4a 转 wav 失败${detail}，请确认 ffmpeg 已安装`, text: '', language: '', autoReason };
      }
      const out = await deps.transcribe(cfg, wav);
      if (out.error) return { message: `${prefix}${out.error}`, text: '', language: '', autoReason };
      if (!out.text) {
        const level = await deps.detectAudioLevel(wav);
        if (level !== null && level.maxDb < -45) {
          return { message: `${prefix}未检测到声音信号（最大音量 ${level.maxDb.toFixed(0)} dB），请检查麦克风`, text: '', language: '', autoReason };
        }
        return { message: `${prefix}未识别到语音内容，请靠近麦克风重试`, text: '', language: '', autoReason };
      }
      const final = out.text.trim();
      return { message: `转写完成（${out.language}）：${final}`, text: final, language: out.language, autoReason, autoSec };
    } finally {
      deps.deleteAudioPair(cfg, file);
      busy = false;
    }
  }

  function cleanup(): void {
    clearTimer();
    recordingChild?.kill();
    recordingChild = null;
    void deps.stopRecording(cfg).catch(() => undefined);
    if (currentFile !== null) {
      deps.deleteAudioPair(cfg, currentFile);
      currentFile = null;
    }
  }

  return { start, stop, cancel, cleanup, isRecording, isTranscribing };
}
