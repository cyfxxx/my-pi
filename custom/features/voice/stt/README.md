# voice/stt — 语音转写后端

`voice` 的语音转写子包：whisper 与 sherpa 两种后端的就绪检测与调用。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `whisper.ts` | whisper 配置读取（模型/设备）与状态 | `whisperModel`、`whisperDevice`、`whisperStatus` |
| `transcription.ts` | 后端健康探测与转写分发 | `defaultWhisperHealth`、`defaultSherpaHealth`、`ensureWhisperService`、`ensureSherpaService`、`transcribe`、`transcribeSherpa`、`transcribeByBackend` |

## 约定

- 后端选择由配置 `PI_VOICE_STT_BACKEND` / `pi-voice.json` 决定；不可用时按策略回退。
- whisper 服务默认端点 `http://127.0.0.1:18766`（可用 `/voice doctor` 体检）。

## 相关

- 录音：[../audio/README.md](../audio/README.md)
- 上层：[../README.md](../README.md)
