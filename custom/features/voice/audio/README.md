# voice/audio — 录音 / 听写 / 唤醒

`voice` 的音频采集与唤醒子包（纯逻辑 + 外部进程调用，零 Pi 依赖）。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `recording.ts` | 录音生命周期：平台录音命令、owner 文件、电平检测、转码 | `resolvePlatform`、`recorderSpec`、`startRecording`/`stopRecording`/`queryRecording`、`ownerOrphaned`、`cleanupStaleAudio`、`detectAudioLevel`、`convertToWav` |
| `dictation.ts` | 听写会话编排（录音→转写→发送） | `createDictation` |
| `wake.ts` | KWS 唤醒监听（Linux + sherpa） | `createWakeSession` |

## 约定

- 录音 owner 文件用于跨进程互斥与孤儿清理。
- 音频产物落在配置的临时目录（非 `portable/` 的持久区）。

## 相关

- 转写后端：[../stt/README.md](../stt/README.md)
- 上层：[../README.md](../README.md)
