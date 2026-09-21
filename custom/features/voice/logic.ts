/**
 * Voice Feature — 纯逻辑 barrel
 *
 * 实现按职责分组：audio/（recording/dictation/wake）、stt/（whisper/transcription）、
 * tts/（tts），以及根层的 config/types/diagnostics。
 */
export * from './types';
export * from './config';
export * from './tts/tts';
export * from './stt/whisper';
export * from './stt/transcription';
export * from './audio/recording';
export * from './audio/wake';
export * from './diagnostics';
export * from './audio/dictation';
