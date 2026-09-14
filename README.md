<p align="center">
  <a href="https://pi.dev">
    <img alt="pi logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@earendil-works/pi-coding-agent?style=flat-square" /></a>
</p>

# Pi Agent Harness（定制版）

基于 [earendil-works/pi](https://github.com/earendil-works/pi) v0.85.1 的定制分支，将 [pi-tools](https://github.com/cyfxxx/pi-tools) 中的 12 个自定义扩展融入框架底层代码。

## 与上游的区别

本仓库在官方 Pi 框架基础上，集成了以下自定义扩展和修改：

### 核心扩展（深度集成）

| 扩展 | 功能 |
|------|------|
| **pi-context** | Token 优化中枢：context 过滤、warm-prefix 重放、thinking 管理、输出裁剪、缓存统计 |
| **plan-mode** | 计划模式：只读规划、任务跟踪、工具调用拦截、进度展示 |
| **pi-memory** | 跨会话持久记忆：自动提取、去重、注入循环 |
| **pi-autopilot** | 自治操作：定时任务、自我管理、故障转移、看门狗、遥测 |

### 外围扩展

| 扩展 | 功能 |
|------|------|
| **pi-web-search** | 网页搜索：SearXNG 私有搜索 + Bing 回退 |
| **pi-browser** | 浏览器自动化：CloakBrowser 隐身浏览器 |
| **pi-intervention** | 干预捕获：abort 快照 + 矫正提示词关联 |
| **pi-link** | 多设备互联：SSH 隧道 RPC 模式 |
| **pi-tmux** | tmux 会话管理：后台任务、输出日志 |
| **pi-mode** | 模式切换：full/light/quick 快速切换 |
| **pi-voice** | 语音通信：Termux 麦克风 + Whisper 转写 + TTS |
| **subagent** | 子代理调度：scout/worker/reviewer 并行编排 |

### 共享服务模块

从 `lib/` 重组为结构化服务：

```
packages/coding-agent/src/custom/services/
├── token-budget/        # context-budget, prune, auto-compact, output-archive
├── diagnostics/         # task-record, usage-diag
├── note-store.ts        # 笔记存储
└── atomic-write.ts      # 原子写入
```

### 框架修改

- `core/secrets.ts`：新增密钥脱敏工具（从 pi-memory 提取）
- `google-shared.ts`：修复 `FinishReason.TOO_MANY_TOOL_CALLS` 类型错误

## 目录结构

```
my-pi/
├── custom/                     # 自定义扩展和服务（顶层，便于维护）
│   ├── extensions/             # 12 个扩展
│   │   ├── pi-context/         # Token 优化中枢
│   │   ├── plan-mode/          # 计划模式
│   │   ├── pi-memory/          # 跨会话记忆
│   │   ├── pi-autopilot/       # 自治操作
│   │   ├── pi-web-search/      # 网页搜索
│   │   ├── pi-browser/         # 浏览器自动化
│   │   ├── pi-intervention/    # 干预捕获
│   │   ├── pi-link/            # 多设备互联
│   │   ├── pi-tmux/            # tmux 管理
│   │   ├── pi-mode/            # 模式切换
│   │   ├── pi-voice/           # 语音通信
│   │   └── subagent/           # 子代理调度
│   ├── services/               # 共享服务模块
│   │   ├── token-budget/       # token 预算管理
│   │   ├── diagnostics/        # 诊断工具
│   │   ├── note-store.ts       # 笔记存储
│   │   ├── atomic-write.ts     # 原子写入
│   │   └── secrets.ts          # 密钥脱敏
│   └── tsconfig.json           # 独立类型检查
├── packages/                   # 官方框架包
│   ├── coding-agent/           # 主 CLI（含框架核心）
│   ├── ai/                     # LLM API 抽象
│   ├── agent/                  # Agent 运行时
│   ├── tui/                    # 终端 UI
│   └── ...
└── ...
```

## 开发

```bash
npm install --ignore-scripts  # 安装依赖
npm run build:offline         # 离线构建（推荐）
npm run check                 # 代码检查
```

### 自定义扩展开发

自定义扩展位于 `custom/extensions/`，通过 jiti 运行时加载，不参与主框架构建。

类型检查：

```bash
npx tsgo --noEmit -p custom/tsconfig.json
```

添加新扩展：

1. 在 `custom/extensions/` 下创建目录
2. 导出默认工厂函数：`export default function(pi: ExtensionAPI) { ... }`
3. 使用 `pi.on()`、`pi.registerTool()`、`pi.registerCommand()` 注册功能

## 从 pi-tools 迁移

本仓库的扩展从 [pi-tools](https://github.com/cyfxxx/pi-tools) 迁移而来。迁移时做了以下适配：

- `import` 路径更新：`../../lib/` → `../../services/`
- TypeScript 类型修复：null safety、implicit any
- 创建 barrel 文件统一 services 入口
- `tsconfig.build.json` 排除 `custom/`（运行时加载，不参与主构建）

## 与上游同步

```bash
git remote add upstream https://github.com/earendil-works/pi.git
git fetch upstream
git merge upstream/main  # 或 cherry-pick 特定提交
```

## 许可证

MIT
