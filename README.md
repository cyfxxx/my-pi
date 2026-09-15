# my-pi: 私人 AI 助手

基于 pi 框架的私人 AI 助手，整合 pi-tools 功能，提供完全受控的 AI 编程体验。

## 项目目标

1. **完全受控**：私人 AI 助手，数据本地存储
2. **功能整合**：整合 pi-tools 的扩展功能
3. **上游兼容**：保持与 pi 上游的同步能力
4. **扩展性强**：支持自定义扩展和功能

## 架构原则

- **上游隔离**：`packages/` 保持只读，从 pi 上游同步
- **自定义分层**：`custom/` 作为独立层，通过适配器与 pi 交互
- **依赖单向**：custom → adapter → packages（不反向依赖）
- **补丁管理**：必须修改 packages/ 时，用补丁追踪

## 目录结构

```
my-pi/
├── packages/                     # pi 上游包（只读同步）
├── custom/
│   ├── src/
│   │   ├── adapters/             # 适配器层（隔离 pi API 变化）
│   │   ├── services/             # 下沉服务（可独立修改）
│   │   └── index.ts
│   ├── extensions/               # 12 个扩展（从 pi-tools 迁移）
│   ├── services/                 # 独立服务层（从 pi-tools 迁移）
│   ├── config/                   # 配置管理
│   ├── seams/                    # 能力接缝
│   ├── events/                   # 事件系统
│   ├── session-log/              # 会话日志
│   ├── bootstrap.ts              # 启动引导
│   ├── extension-loader.ts       # 扩展加载器
│   ├── integration.ts            # 集成层
│   ├── skills/                   # 技能层
│   ├── agents/                   # Agent 编排
│   ├── prompts/                  # Prompt 模板
│   ├── docs/                     # 项目文档
│   └── tests/                    # 测试文件
├── scripts/
│   ├── core/                     # 核心脚本（rebuild/wrapper/source-build）
│   ├── crash-recovery/           # 崩溃恢复
│   ├── maintenance/              # 日常维护
│   ├── install/                  # 安装脚本
│   ├── test/                     # 测试脚本
│   ├── environment/              # 环境脚本
│   ├── mypi                      # mypi 启动脚本
│   ├── sync-upstream.sh          # 上游同步
│   ├── create-patch.sh           # 补丁管理
│   └── apply-patches.sh          # 补丁管理
├── packs/                        # 技能包（18 个外部技能包）
├── deploy/                       # 部署配置（systemd, tmux）
├── portable/                     # 便携配置（Windows 便携包）
├── searxng/                      # SearXNG 自托管搜索
├── patches/                      # 补丁管理
├── docs/                         # 文档
│   ├── design/                   # 设计文档
│   ├── development/              # 开发文档
│   ├── operations/               # 运维文档
│   └── maintenance/              # 维护文档
├── package.json                  # monorepo 配置
├── README.md                     # 项目说明
├── AGENTS.md                     # 开发规范
├── CHANGELOG.md                  # 版本记录
└── .github/workflows/ci.yml     # CI 配置
```

## 快速开始

```bash
# 构建
npm run build:offline

# 运行
mypi --list-models
mypi -p "你的问题"

# 重建
./scripts/core/rebuild.sh

# 测试
./scripts/test/smoke-test.sh
```

## 核心功能

### 12 个扩展

| 扩展 | 功能 |
|------|------|
| pi-autopilot | 自主运行（定时任务 + 自管理 + 失败自愈） |
| pi-browser | 浏览器自动化（CloakBrowser） |
| pi-context | Token 优化中枢（路由/thinking 剪枝/compaction 去重/输出截断） |
| pi-intervention | 干预捕获（abort 快照/corrective prompt） |
| pi-link | 多设备互联（SSH 通道 + 远程 RPC） |
| pi-memory | 跨会话持久记忆（自主学习闭环） |
| pi-mode | 模式切换（full/light/quick） |
| pi-tmux | tmux 会话管理（后台任务/长任务） |
| pi-voice | 语音交流（Termux：录音转写 + TTS） |
| pi-web-search | 网络搜索（SearXNG 私密搜索） |
| plan-mode | 计划模式（TUI 计划/任务管理） |
| subagent | 子代理（delegate 给专门 agent） |

### 核心脚本

| 脚本 | 功能 |
|------|------|
| rebuild.sh | 一键重建（幂等、并行、镜像加速） |
| pi-wrapper.sh | 进程外生命周期管理器（崩溃恢复/熔断器/快照） |
| pi-source-build.sh | 从源码构建 pi |
| daily-health.mjs | 每日健康检查 |
| verify-patches.mjs | 补丁版本匹配校验 |

### 18 个技能包

- cangjie-skill：书籍蒸馏
- colab-bridge：Google Colab 远程 GPU
- comfyui-agent：ComfyUI 图像生成
- dg-piagent：pi-agent SDK 开发
- embedded-dev：嵌入式开发
- gamedev：游戏开发
- knowledge-fetch：知识订阅
- media-toolkit：图片/视频处理
- novel-writing：长篇小说
- pcb-design：PCB 硬件设计
- pdf-toolkit：PDF 处理
- repo-size-audit：git 仓库审计
- skill-integration：技能包整合
- wechatide-skill：微信开发
- ...

## 文档

### 架构文档
- [项目架构](custom/docs/ARCHITECTURE.md)
- [实施计划](custom/docs/IMPLEMENTATION-PLAN.md)
- [目录结构](custom/docs/DIRECTORY-STRUCTURE.md)

### 迁移文档
- [工具系统下沉方案](custom/docs/TOOL-SYSTEM-SINKING.md)
- [会话管理下沉方案](custom/docs/SESSION-MANAGEMENT-SINKING.md)
- [补丁管理](custom/docs/PATCH-MANAGEMENT.md)
- [上游同步](custom/docs/UPSTREAM-SYNC.md)
- [pi-tools 迁移计划](custom/docs/MIGRATION-PLAN-PI-TOOLS.md)

### 运维文档
- [设计文档](docs/design/VISION.md)
- [开发文档](docs/development/AGENTS-DETAILS.md)
- [运维文档](docs/operations/ENVIRONMENTS.md)
- [维护文档](docs/maintenance/OPTIMIZATION-LOG.md)

### pi-tools 文档
- [pi-tools README](docs/PI-TOOLS-README.md)
- [版本记录](CHANGELOG.md)

## 维护者

- 项目所有者：[你的名字]

## 许可证

私人项目，保留所有权利
