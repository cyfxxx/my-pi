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

```
custom/services/
├── token-budget/        # context-budget, prune, auto-compact, output-archive
├── diagnostics/         # task-record, usage-diag
├── note-store.ts        # 笔记存储
├── atomic-write.ts      # 原子写入
└── secrets.ts           # 密钥脱敏（从 core/secrets.ts 提取）
```

### 框架修改

- `packages/ai/src/api/google-shared.ts`：修复 `FinishReason.TOO_MANY_TOOL_CALLS` 类型错误
- `packages/coding-agent/src/core/secrets.ts`：新增密钥脱敏工具（原始版本，custom 中为副本）

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

## 更新同步流程

本仓库有两个上游来源，需要分别跟踪：

### 1. 从 pi 源码仓库获取框架更新

pi 框架本身的 bug 修复和新功能。

```bash
# 添加上游 remote（只需一次）
git remote add upstream https://github.com/earendil-works/pi.git

# 同步流程
git fetch upstream
git log --oneline HEAD..upstream/main  # 查看上游新提交
git merge upstream/main                # 合并（或 cherry-pick 特定提交）
npm run build:offline                  # 重新构建
npx tsgo --noEmit -p custom/tsconfig.json  # 检查自定义扩展兼容性
# 如果有冲突，解决后重新构建验证
```

**注意事项**：
- 合并前先在分支上测试，不要直接合到 main
- 关注 `packages/coding-agent/src/core/extensions/types.ts` 的 API 变更
- 上游新增事件类型可能影响自定义扩展的类型检查

### 2. 从 pi-tools 获取扩展更新

pi-tools 是扩展的原始开发仓库，扩展的新功能和 bug 修复在这里进行。

```bash
# 同步流程（手动复制）
cd /path/to/pi-tools

# 查看扩展变更
git log --oneline -10 -- agent/extensions/

# 确认需要同步的扩展后，复制到 my-pi
cp -r agent/extensions/<扩展名> /path/to/my-pi/custom/extensions/

# 在 my-pi 中适配
cd /path/to/my-pi
# 1. 更新 import 路径（lib/ → services/）
# 2. 检查类型兼容性
npx tsgo --noEmit -p custom/tsconfig.json
# 3. 验证构建
npm run build:offline
```

**同步检查清单**：

| 检查项 | 命令 |
|--------|------|
| import 路径 | `grep -rn "from.*lib/" custom/extensions/` |
| 类型兼容 | `npx tsgo --noEmit -p custom/tsconfig.json` |
| 框架构建 | `npm run build:offline` |
| 扩展发现 | 运行 `pi list` 或启动交互模式 |

**已知的路径映射**：

| pi-tools 路径 | my-pi 路径 |
|---------------|------------|
| `agent/extensions/` | `custom/extensions/` |
| `agent/lib/` | `custom/services/` |
| `agent/services/` | `custom/services/` |
| `agent/core/secrets.ts` | `custom/services/secrets.ts` |

### 3. 同步顺序建议

1. **先同步 pi-tools 的扩展更新**（扩展代码变更更频繁）
2. **再同步 pi 框架更新**（API 变更影响面更大）
3. **每次同步后运行完整验证**：

```bash
npm run build:offline && npx tsgo --noEmit -p custom/tsconfig.json
```

## 许可证

MIT
