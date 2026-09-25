# voice/tts — 朗读（TTS）

`voice` 的文本转语音子包：引擎选择、朗读执行与自动朗读调度。

## 文件

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `tts.ts` | 引擎选择（piper/espeak）、朗读执行、文本清洗、自动朗读分发 | `selectTtsEngine`、`speak`、`cleanForSpeech`、`isSpeechWorthy`、`createTtsDispatcher`、`extractAssistantText` |

## 约定

- 引擎选择按平台与可用性：优先 `piper`，缺失时回退 `espeak`（Termux 下按 `isTermux()` 走对应分支）。
- 朗读前用 `cleanForSpeech` 去掉代码块/标记并截断（默认 400 字符），`isSpeechWorthy` 过滤不适合朗读的回复。
- 自动朗读由 `message_end` 钩子经 `createTtsDispatcher` 触发，受 `/voice toggle` 与模式控制。
- 音频临时文件写入配置的临时目录并在播放后清理。

## 相关

- 转写：[../stt/README.md](../stt/README.md)
- 录音：[../audio/README.md](../audio/README.md)
- 上层：[../README.md](../README.md)
