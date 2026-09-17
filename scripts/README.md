# scripts 目录

Pi 项目脚本集合，按职责分类到子目录。

## 目录结构

```
scripts/
├── core/                  # 核心脚本（进程管理/重建）
│   ├── pi-wrapper.sh      # 进程外生命周期管理器（入口）
│   ├── pi-orig.sh         # 绕过 wrapper 直接启动 Pi CLI
│   ├── rebuild.sh         # 全量重建 pi
│   └── pi-source-build.sh # 从源码构建 pi
│
├── build/                 # 构建/发布脚本
│   ├── build-binaries.sh  # 构建二进制文件
│   ├── build-coding-agent-bundle.mjs
│   ├── create-source-archive.sh
│   ├── local-release.mjs
│   ├── package-workspaces.mjs
│   ├── publish.mjs
│   ├── publish-model-catalog.mjs
│   ├── publish-release-announcement.mjs
│   ├── release.mjs
│   ├── release-notes.mjs
│   └── release-packages.mjs
│
├── check/                 # 检查脚本
│   ├── check-browser-smoke.mjs
│   ├── check-entry-graphs.mjs
│   ├── check-lockfile-commit.mjs
│   ├── check-pinned-deps.mjs
│   ├── check-runtime-deps.mjs
│   ├── check-ts-relative-imports.mjs
│   └── coding-agent-consumer.mjs
│
├── tools/                 # 工具脚本
│   ├── apply-patches.sh
│   ├── create-patch.sh
│   ├── setup-config.sh
│   ├── setup-env.sh
│   ├── sync-upstream.sh
│   ├── auto-pi.sh
│   ├── migrate-config.sh
│   ├── update-source-imports-to-ts.sh
│   ├── diff-model-catalog.mjs
│   ├── docs-check.mjs
│   ├── docs-freshness.mjs
│   ├── edit-tool-stats.mjs
│   ├── generate-coding-agent-install-lock.mjs
│   ├── generate-coding-agent-shrinkwrap.mjs
│   ├── generate-thinking-capabilities.mjs
│   ├── profile-coding-agent-node.mjs
│   ├── read-tool-stats.mjs
│   ├── session-context-stats.mjs
│   ├── sync-versions.js
│   └── repro-5893-wsl-bash.mjs
│
├── ts/                    # TypeScript 入口文件
│   ├── agent-treeshake-smoke-entry.ts
│   ├── browser-smoke-entry.ts
│   ├── cost.ts
│   ├── session-transcripts.ts
│   ├── stats.ts
│   └── tool-stats.ts
│
├── crash-recovery/        # 崩溃恢复
│   ├── pi-crash-analyzer.sh
│   ├── pi-recovery-audit.sh
│   └── pi-rescue.sh
│
├── deploy/                # 部署脚本
│   ├── setup-new-device.sh
│   └── sync-config.sh
│
├── environment/           # 环境准备
│   └── termux-prereq.sh
│
├── install/               # 安装脚本
│   ├── install-cron.sh
│   ├── install-systemd.sh
│   └── install-wrapper.sh
│
├── maintenance/           # 日常维护
│   ├── daily-health.mjs
│   ├── pi-bench.sh
│   ├── verify-patches.mjs
│   ├── npm-missing-deps.py
│   ├── doc-extract.py
│   ├── doc-lint.mjs
│   ├── lesson-miner.mjs
│   ├── check-cache-impact.sh
│   ├── migrate-tool-events.sh
│   ├── packs-sync.sh
│   ├── golden-tasks.sh
│   └── docker-rebuild-test.sh
│
├── test/                  # 测试脚本
│   ├── test-all.sh
│   ├── test-recovery.sh
│   └── smoke-test.sh
│
└── README.md              # 本说明
```

## 使用方式

```bash
# 全量重建
bash scripts/core/rebuild.sh

# 全量回归测试
bash scripts/test/test-all.sh

# 快速测试单个扩展
bash scripts/test/test-all.sh --only=pi-context,pi-memory

# 健康检查
node scripts/maintenance/daily-health.mjs

# 用量基准
bash scripts/maintenance/pi-bench.sh usage

# 检查 npm 依赖
python3 scripts/maintenance/npm-missing-deps.py .pi/extensions/pi-voice

# 文档一致性检查
node scripts/maintenance/doc-lint.mjs
```

## 约束

- **pi-wrapper.sh** 是唯一推荐的 pi 启动入口，不要直接调用 pi CLI
- **rebuild.sh** 必须在 pi 停止时执行（避免 dist 文件被占用）
- **test-all.sh** 支持 `--only`/`--fast`/`--no-tsc` 参数分层验证
- 所有脚本遵循 `set -euo pipefail` 严格模式

## 相关文档

- 项目开发规范：`.pi/AGENTS.md`
- 架构文档：`docs/architecture.md`
