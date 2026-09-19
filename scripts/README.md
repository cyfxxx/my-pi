# scripts 目录

Pi 项目脚本集合，按职责分类到子目录。

## 目录结构

```
scripts/
├── paths.sh                 # 路径集中定义（所有脚本 source 引用）
├── core/                    # 核心脚本（进程管理/重建）
│   ├── pi-wrapper.sh        # 进程外生命周期管理器（入口）
│   ├── pi-orig.sh           # 绕过 wrapper 直接启动 Pi CLI
│   ├── rebuild.sh           # 全量重建 pi
│   └── pi-source-build.sh   # 从源码构建 pi
│
├── build/                   # 构建/发布脚本
│   ├── build-binaries.sh    # 构建二进制文件
│   └── ...
│
├── check/                   # 检查脚本
│   ├── check-paths.sh       # 路径一致性检查
│   └── ...
│
├── tools/                   # 工具脚本
├── ts/                      # TypeScript 入口文件
├── crash-recovery/          # 崩溃恢复
├── deploy/                  # 部署脚本
├── environment/             # 环境准备
├── install/                 # 安装脚本
├── maintenance/             # 日常维护
├── test/                    # 测试脚本
└── README.md                # 本说明
```

## 路径管理（重要）

**所有路径通过 `paths.sh` 集中定义**，目录结构调整时只需修改此文件。

### 使用方式

```bash
# 在脚本开头加载路径配置
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$PROJECT_SCRIPTS_DIR/paths.sh"

# 使用路径变量
echo "$SETTINGS_JSON"      # → ~/.pi/settings.json
echo "$EXTENSIONS_DIR"     # → ~/.pi/extensions
echo "$REBUILD_SCRIPT"     # → scripts/core/rebuild.sh
```

### 路径验证

```bash
# 检查脚本中是否存在硬编码的旧路径
bash scripts/check/check-paths.sh
```

### 新增路径

在 `paths.sh` 中添加新路径变量：
```bash
# 新增路径
NEW_DIR="$PI_HOME/new-dir"
NEW_SCRIPT="$SCRIPTS_DIR/new-script.sh"
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
- **路径硬编码禁止**：新脚本必须使用 `paths.sh` 中的变量

## 相关文档

- 项目开发规范：`.pi/AGENTS.md`
- 架构文档：`docs/architecture.md`
- 迁移经验：`docs/maintenance/LESSONS-LEARNED.md`
