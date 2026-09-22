# voice — 语音交流

录音 → 转写 → 发送，以及助手回复的语音朗读（TTS）。含唤醒监听（KWS）与基准测试。

## 注册面

- 工具：`voice_transcribe`、`voice_speak`、`voice_record`
- 命令：`/voice <status|toggle|tts|record|model|device|backend|language|doctor|wake|bench|help>`
- 快捷键：一条（见 `index.ts` 的 `registerShortcut`）
- 钩子：`session_start`、`session_shutdown`、`message_end`（自动朗读）

## 文件

| 文件 | 职责 |
|------|------|
| `index.ts` | 注册工具/命令/快捷键/钩子 |
| `logic.ts` | 纯逻辑 barrel |
| `types.ts` | 类型与进程执行工具（`runCommand`、`nowStamp`） |
| `config.ts` | 配置加载/持久化（`loadConfig`/`persistConfig`）、`defaultTmpDir` |
| `diagnostics.ts` | `doctor`、`benchmark`、平台安装指引 |
| `audio/` | 录音/听写/唤醒，见 [audio/README.md](audio/README.md) |
| `stt/` | 语音转写后端，见 [stt/README.md](stt/README.md) |
| `tts/` | 语音合成（`tts.ts`） |

## 数据与配置

| 路径 | 内容 | 覆盖变量 |
|------|------|----------|
| `portable/agent/pi-voice.json` | 语音配置（后端/设备/语言/引擎） | `PI_VOICE_CONFIG` |
| `portable/memory/voice/` | 录音/模型/服务脚本等 | `PI_VOICE_*` |

环境变量：`PI_VOICE_LANGUAGE`、`PI_VOICE_STT_BACKEND`、`PI_VOICE_LINUX_TTS_RATE`。

## 外部依赖（可选，按需安装）

`ffmpeg`（转码）、`whisper` 服务（转写）、`sherpa-onnx`（唤醒/后端）、`piper`/`espeak-ng`（TTS）。用 `/voice doctor` 体检。
