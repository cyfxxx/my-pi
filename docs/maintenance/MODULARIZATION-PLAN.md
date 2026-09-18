# 模块化整合方案

**日期**: 2026-09-07  
**更新**: 2026-09-18 目录结构扁平化  
**基线提交**: `17d3a99` (remove pi-webui extension)  
**状态**: 已完成 — Phase 1-7 已执行（2026-09-08/09-09），后续扁平化（2026-09-15/18）  
**目标**: 将 .pi 目录从"扁平散落"重构为"分层架构 + 功能内聚"

## 元信息

| 属性 | 值 |
|------|-----|
| 版本 | v2.0 |
| 更新日期 | 2026-09-18 |
| 适用范围 | 模块化整合、分层架构设计 |
| 相关文档 | [AGENTS-DETAILS.md](../development/AGENTS-DETAILS.md), [VISION.md](../design/VISION.md) |

---

## 目录

- [一、已完成项](#一已完成项)
- [二、分层架构设计](#二分层架构设计)
- [三、兼容策略](#三兼容策略)
- [四、模块化要求](#四模块化要求)
- [五、风险评估](#五风险评估)
- [六、验证命令](#六验证命令)
- [七、迁移后遇到的问题](#七迁移后遇到的问题)

---

## 已完成项

### 第一阶段：扩展内聚（2026-09-08）

- ✅ Phase 1: 配置文件移入扩展目录（pi-link/config/、pi-voice/config/、pi-autopilot/config/）
- ✅ Phase 2: 脚本移入扩展目录（26个脚本 → extension/scripts/，symlink 到 scripts/）
- ✅ Phase 3: 运行时状态文件移入扩展目录（.notify-state.json、.pi-tmux-registry.json 等）
- ✅ Phase 4: lib/index.ts 统一导出
- ✅ Phase 5: 代码和文档中的路径引用更新
- ✅ symlink 修复：scripts/ 下25个断裂 symlink 相对路径修正
- ✅ pi-webui 移除、agent/recovery/cache 加入 .gitignore

### 第二阶段：分层架构重构（2026-09-09）

- ✅ Phase 1: 拆分 agent/lib/ → core/ + services/
  - core/ (Layer 0): config.ts, registry.ts, hook-registry.ts, secrets.ts, index.ts
  - services/ (Layer 1): token-budget/, diagnostics/, shadow-review.ts, note-store.ts
  - lib/ 保留为兼容层，重导出 core/ 和 services/
- ✅ Phase 2: 剩余脚本移入扩展目录（pi-cron.sh, task-metrics.mjs 等）
- ✅ Phase 3: 文档分类（docs/ → design/, development/, operations/, maintenance/）
- ✅ Phase 4: 运行时数据归组（memory/, logs/, plans/ → data/）
- ✅ Phase 5: .gitignore 更新 + 导入验证测试通过

### 第三阶段：目录结构扁平化（2026-09-15/18）

- ✅ 扩展迁移：12 个扩展从 `.pi/agent/extensions/` 迁移到 `.pi/extensions/`
- ✅ 配置统一：settings.json、models.json 等配置文件移到 `.pi/` 根目录
- ✅ 脚本整理：scripts/ 按职责分类到子目录（core/, build/, check/, tools/, ts/）
- ✅ 符号链接：.pi/scripts/ 创建符号链接指向项目 scripts/
- ✅ PI_CODING_AGENT_DIR：设置环境变量重定向配置读取
- ✅ 路径修复：更新所有脚本中的路径引用

---

## 分层架构设计

### 五层单向依赖架构

```
Layer 4 ─ Agent 编排层 ─────── (由 pi 内置调度)
    ↑
Layer 3 ─ 技能层 ───────────── .pi/skills/ packs/
    ↑
Layer 2 ─ 扩展层 ───────────── .pi/extensions/ (每个扩展独立)
    ↑
Layer 1 ─ 服务层 ───────────── .pi/services/ (token-budget, diagnostics)
    ↑
Layer 0 ─ 基础层 ───────────── .pi/core/ (config, registry, secrets)
```

### 依赖规则

1. **单向依赖**: Layer N 只能依赖 Layer N-1 及以下，底层不能依赖上层
2. **同层独立**: 同层模块之间禁止相互依赖
3. **扩展独立**: 12 个扩展之间禁止相互依赖

### 分层职责

| 层 | 目录 | 职责 | 包含模块 |
|----|------|------|----------|
| L0 基础层 | `.pi/core/` | 零依赖的基础工具 | config, registry, hook-registry, secrets |
| L1 服务层 | `.pi/services/` | 核心服务（仅依赖 L0） | token-budget, diagnostics, shadow-review, note-store |
| L2 扩展层 | `.pi/extensions/` | 功能模块（依赖 L0+L1） | 12 个独立扩展 |
| L3 技能层 | `.pi/skills/` + `packs/` | 用户技能（依赖 L0-L2） | 6 个内置技能 + 外部技能包 |
| L4 编排层 | (由 pi 内置调度) | Agent 定义（依赖全部） | scout, worker, reviewer |

### 目录结构（2026-09-18 确立）

```
.pi/
├── core/                        # Layer 0: 基础层
│   ├── config.ts               # 配置加载/合并
│   ├── registry.ts             # 注册/清理统一封装
│   ├── hook-registry.ts        # 扩展钩子注册表
│   ├── secrets.ts              # 密钥脱敏工具
│   └── index.ts                # 统一导出
│
├── services/                    # Layer 1: 服务层
│   ├── token-budget/           # Token 预算管理
│   │   ├── context-budget.ts
│   │   ├── prune.ts
│   │   ├── auto-compact.ts
│   │   ├── output-archive.ts
│   │   └── index.ts
│   ├── diagnostics/            # 诊断服务
│   │   ├── usage-diag.ts
│   │   ├── task-record.ts
│   │   └── index.ts
│   ├── shadow-review.ts        # 影子审查
│   ├── note-store.ts           # 笔记持久化
│   └── index.ts                # 统一导出
│
├── extensions/                  # Layer 2: 扩展层
│   ├── pi-autopilot/           # 自主运行（定时任务+自管理+失败自愈）
│   ├── pi-browser/             # 浏览器自动化
│   ├── pi-context/             # Token 优化中枢
│   ├── pi-intervention/        # 干预捕获
│   ├── pi-link/                # 多设备互联
│   ├── pi-memory/              # 跨会话记忆
│   ├── pi-mode/                # 模式切换
│   ├── pi-tmux/                # tmux 会话管理
│   ├── pi-voice/               # 语音交流
│   ├── pi-web-search/          # 网络搜索
│   ├── plan-mode/              # 计划模式
│   └── subagent/               # 子代理
│
├── skills/                      # Layer 3: 技能层
│   ├── pi-backup/
│   ├── pi-bug-diagnosis/
│   ├── pi-code-review/
│   ├── pi-full-audit/
│   ├── pi-repo-optimize/
│   └── pi-translate-zh/
│
├── scripts/                     # 符号链接 → 项目 scripts/
│   ├── core -> ../../scripts/core
│   ├── crash-recovery -> ../../scripts/crash-recovery
│   ├── install -> ../../scripts/install
│   ├── maintenance -> ../../scripts/maintenance
│   └── test -> ../../scripts/test
│
├── data/                        # 运行时数据
│   ├── memory/                  # 记忆数据
│   ├── logs/                    # 日志
│   └── plans/                   # 计划存档
│
├── settings.json                # 主配置
├── models.json                  # 模型配置
├── auth.json                    # API 凭证
├── modes.json                   # 模式配置
├── keybindings.json             # 快捷键配置
├── models-store.json            # 模型存储
│
├── AGENTS.md                    # 项目环境描述
├── APPEND_SYSTEM.md             # 系统提示追加内容
├── trust.json                   # 信任设置
└── README.md                    # 目录说明
```

---

## 兼容策略

### 保留的兼容层

| 兼容层 | 位置 | 清理日期 | 说明 |
|--------|------|----------|------|
| .pi/scripts/ 符号链接 | `.pi/scripts/` | 永久保留 | 指向项目 scripts/，保持向后兼容 |
| data/ 符号链接 | `.pi/memory` → `data/memory/` | 永久保留 | 保持旧路径可访问 |
| data/ 符号链接 | `.pi/logs` → `data/logs/` | 永久保留 | 保持旧路径可访问 |

### 已清理的兼容层

| 兼容层 | 清理日期 | 说明 |
|--------|----------|------|
| lib/ 兼容层 | 2026-09-14 | 10 个完整实现文件转为 thin re-export shim |
| scripts/ flat 文件 | 2026-09-18 | 旧的 flat 脚本替换为符号链接 |
| agent/ 目录 | 2026-09-15 | 配置和扩展移到 .pi/ 根目录 |

---

## 模块化要求

1. **扩展自包含**: 每个扩展的配置、脚本、状态文件必须在 `extensions/<name>/` 下
   - 配置: `extensions/<name>/config/` 或 `extensions/<name>/*.json`
   - 脚本: `extensions/<name>/scripts/`
   - 状态: `extensions/<name>/.<name>-*.json`
   - 测试: `extensions/<name>/tests/`
   - 文档: `extensions/<name>/README.md`

2. **禁止散落**: 扩展文件不得出现在 `.pi/` 根目录或 `scripts/` 根目录
   - 例外: `.pi/settings.json`、`.pi/models.json` 等共用配置
   - 例外: `.pi/AGENTS.md`、`.pi/APPEND_SYSTEM.md` 等共用文档

3. **依赖方向**: 严格自下而上
   - core/ → services/ → extensions/ → skills/ → (pi 内置调度)
   - 同层模块之间禁止相互依赖

4. **导入规范**: 新代码应从 core/ 或 services/ 导入，不从 lib/ 导入

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| PI_CODING_AGENT_DIR 未设置 | 高 | 在 mypi 和 pi-wrapper.sh 中设置环境变量 |
| 脚本路径引用错误 | 中 | 使用 ROOT 变量统一引用项目根目录 |
| 符号链接断裂 | 低 | 逐步验证，保留兼容层 |
| 配置文件位置错误 | 高 | 配置文件必须在 .pi/ 根目录 |
| 扩展自动发现失败 | 高 | 保持 extensions/ 结构不变 |

---

## 验证命令

```bash
# 1. 检查 mypi 命令
mypi --version
mypi --list-models

# 2. 检查配置读取
PI_CODING_AGENT_DIR=/root/my-pi/.pi node -e "
const fs = require('fs');
const path = require('path');
const agentDir = process.env.PI_CODING_AGENT_DIR;
const settings = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
console.log('Provider:', settings.defaultProvider);
console.log('Model:', settings.defaultModel);
"

# 3. 运行冒烟测试
bash scripts/test/smoke-test.sh

# 4. 运行全量测试
bash scripts/test/test-all.sh

# 5. 运行 npm 检查
npm run check:pinned-deps
npm run check:runtime-deps
npm run check:ts-imports

# 6. 类型检查
cd .pi/extensions && npx tsc --noEmit
```

---

## 迁移后遇到的问题

### PI_CODING_AGENT_DIR 环境变量问题

**问题**：pi 启动时报 "No API key found for the selected model"

**根因**：pi 默认从 `~/.pi/agent/` 读取配置，但迁移后配置在项目 `.pi/` 目录

**解决方案**：
```bash
# /usr/local/bin/mypi
#!/bin/bash
export PI_CODING_AGENT_DIR="$HOME/my-pi/.pi"
exec node ~/my-pi/packages/coding-agent/dist/bundle/cli.js "$@"
```

### 脚本路径引用错误

**问题**：迁移后脚本中的路径引用指向旧位置

**根因**：脚本从 `~/.pi/scripts/` 复制后，内部路径未更新

**解决方案**：使用 `ROOT` 变量统一引用项目根目录
```bash
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
"$ROOT/scripts/check/check-pinned-deps.mjs"
```

### pre-commit hook 路径错误

**问题**：git commit 时报 hook 脚本找不到

**根因**：`.husky/pre-commit` 中路径变化

**解决方案**：
```bash
# .husky/pre-commit
node scripts/check/check-lockfile-commit.mjs
```

### TypeScript 配置问题

**问题**：`tsgo --noEmit` 编译失败

**根因**：`tsconfig.json` 中的 `baseUrl` 导致路径解析错误

**解决方案**：
```json
{
  "compilerOptions": {
    "baseUrl": null,
    "paths": {}
  },
  "exclude": ["tests", "pi-browser"]
}
```

### Biome 配置问题

**问题**：biome 检查第三方代码

**根因**：`.pi/searxng/` 目录包含第三方代码

**解决方案**：
```json
{
  "ignore": [".pi/searxng/**/*"]
}
```
