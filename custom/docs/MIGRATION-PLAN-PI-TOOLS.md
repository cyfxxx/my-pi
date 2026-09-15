# pi-tools → my-pi 完整迁移计划

## 一、迁移原则

1. **不修改 pi-tools**：所有操作在 my-pi 中进行
2. **保留 pi-tools 结构**：在 my-pi 中创建对应的目录结构
3. **处理冲突**：以 my-pi 为主，pi-tools 内容作为参考
4. **保持兼容**：确保迁移后功能正常

## 二、迁移范围

### 2.1 需要迁移的内容

| 类别 | 内容 | 优先级 |
|------|------|--------|
| **核心脚本** | rebuild.sh, pi-wrapper.sh, pi-orig.sh, pi-source-build.sh | P0 |
| **崩溃恢复** | pi-crash-analyzer.sh, pi-recovery-audit.sh, pi-rescue.sh | P0 |
| **日常维护** | daily-health.mjs, verify-patches.mjs, npm-missing-deps.py, packs-sync.sh | P0 |
| **安装脚本** | install-cron.sh, install-systemd.sh, install-wrapper.sh, install-tool-sync-hooks.sh | P1 |
| **测试脚本** | test-all.sh, test-recovery.sh, smoke-test.sh | P1 |
| **环境脚本** | termux-prereq.sh | P2 |
| **扩展** | 12 个扩展（完整内容） | P0 |
| **服务** | agent/services/ 目录 | P0 |
| **技能** | agent/skills/ 目录 | P1 |
| **Agent** | agent/agents/ 目录 | P1 |
| **Prompt** | agent/prompts/ 目录 | P1 |
| **配置** | settings.json, modes.json, keybindings.json, pi-voice.json, notify.json, scheduled-tasks.json, scheduled-seeds.json | P0 |
| **技能包** | packs/ 目录（18 个外部技能包） | P2 |
| **部署配置** | deploy/ 目录（systemd, tmux） | P1 |
| **便携配置** | portable/ 目录（Windows 便携包） | P2 |
| **SearXNG** | searxng/ 目录 | P2 |
| **文档** | docs/ 目录 + README.md + CHANGELOG.md | P1 |
| **CI** | .github/workflows/ci.yml | P2 |

### 2.2 已存在于 my-pi 的内容（需要对比更新）

| 内容 | my-pi 位置 | 处理方式 |
|------|------------|----------|
| 12 个扩展 | custom/extensions/ | 以 pi-tools 为准，覆盖更新 |
| services | custom/services/ + custom/src/services/ | 合并，保留 my-pi 的下沉架构 |
| scripts | scripts/ | 保留 my-pi 独有脚本，添加 pi-tools 脚本 |
| docs | custom/docs/ | 整合 pi-tools 文档 |
| package.json | package.json | 保留 my-pi 的 monorepo 配置 |

## 三、目录结构设计

### 3.1 迁移后的 my-pi 结构

```
my-pi/
├── packages/                     # pi 上游包（只读同步）
├── custom/
│   ├── src/
│   │   ├── adapters/             # 适配器层（保留）
│   │   ├── services/             # 下沉服务（保留）
│   │   └── index.ts
│   ├── extensions/               # 12 个扩展（从 pi-tools 迁移）
│   ├── services/                 # 独立服务层（从 pi-tools 迁移）
│   ├── config/                   # 配置管理（保留）
│   ├── seams/                    # 能力接缝（保留）
│   ├── events/                   # 事件系统（保留）
│   ├── session-log/              # 会话日志（保留）
│   ├── bootstrap.ts              # 启动引导（保留）
│   ├── extension-loader.ts       # 扩展加载器（保留）
│   ├── integration.ts            # 集成层（保留）
│   ├── docs/                     # 文档（整合）
│   └── tests/                    # 测试
├── scripts/
│   ├── core/                     # 核心脚本（从 pi-tools 迁移）
│   │   ├── rebuild.sh
│   │   ├── pi-wrapper.sh
│   │   ├── pi-orig.sh
│   │   └── pi-source-build.sh
│   ├── crash-recovery/           # 崩溃恢复（从 pi-tools 迁移）
│   ├── maintenance/              # 日常维护（从 pi-tools 迁移）
│   ├── install/                  # 安装脚本（从 pi-tools 迁移）
│   ├── test/                     # 测试脚本（从 pi-tools 迁移）
│   ├── environment/              # 环境脚本（从 pi-tools 迁移）
│   ├── mypi                      # mypi 启动脚本（保留）
│   ├── sync-upstream.sh          # 上游同步（保留）
│   ├── create-patch.sh           # 补丁管理（保留）
│   └── apply-patches.sh          # 补丁管理（保留）
├── packs/                        # 技能包（从 pi-tools 迁移）
├── deploy/                       # 部署配置（从 pi-tools 迁移）
├── portable/                     # 便携配置（从 pi-tools 迁移）
├── searxng/                      # SearXNG（从 pi-tools 迁移）
├── patches/                      # 补丁管理（保留）
├── docs/                         # 文档（整合）
│   ├── design/                   # 设计文档
│   ├── development/              # 开发文档
│   ├── operations/               # 运维文档
│   └── maintenance/              # 维护文档
├── package.json                  # monorepo 配置（保留）
├── README.md                     # 项目说明（整合）
├── AGENTS.md                     # 开发规范（整合）
├── CHANGELOG.md                  # 版本记录（从 pi-tools 迁移）
└── .github/workflows/ci.yml     # CI 配置（从 pi-tools 迁移）
```

## 四、迁移步骤

### Phase 1: 迁移核心脚本

```bash
# 1. 创建目录结构
mkdir -p scripts/core
mkdir -p scripts/crash-recovery
mkdir -p scripts/maintenance
mkdir -p scripts/install
mkdir -p scripts/test
mkdir -p scripts/environment

# 2. 复制核心脚本
cp ~/.pi/scripts/rebuild.sh scripts/core/
cp ~/.pi/scripts/pi-wrapper.sh scripts/core/
cp ~/.pi/scripts/pi-orig.sh scripts/core/
cp ~/.pi/scripts/pi-source-build.sh scripts/core/

# 3. 复制崩溃恢复脚本
cp ~/.pi/scripts/crash-recovery/*.sh scripts/crash-recovery/

# 4. 复制日常维护脚本
cp ~/.pi/scripts/maintenance/* scripts/maintenance/

# 5. 复制安装脚本
cp ~/.pi/scripts/install/* scripts/install/

# 6. 复制测试脚本
cp ~/.pi/scripts/test/* scripts/test/

# 7. 复制环境脚本
cp ~/.pi/scripts/environment/* scripts/environment/
```

### Phase 2: 迁移扩展和服务

```bash
# 1. 复制扩展（以 pi-tools 为准）
cp -r ~/.pi/agent/extensions/* custom/extensions/

# 2. 复制服务
cp -r ~/.pi/agent/services/* custom/services/

# 3. 复制技能
cp -r ~/.pi/agent/skills/* custom/skills/

# 4. 复制 Agent
cp -r ~/.pi/agent/agents/* custom/agents/

# 5. 复制 Prompt
cp -r ~/.pi/agent/prompts/* custom/prompts/
```

### Phase 3: 迁移配置

```bash
# 1. 复制配置文件
cp ~/.pi/agent/settings.json custom/config/
cp ~/.pi/agent/modes.json custom/config/
cp ~/.pi/agent/keybindings.json custom/config/
cp ~/.pi/agent/pi-voice.json custom/config/
cp ~/.pi/agent/notify.json custom/config/
cp ~/.pi/agent/scheduled-tasks.json custom/config/
cp ~/.pi/agent/scheduled-seeds.json custom/config/

# 2. 复制 package.json（合并依赖）
cp ~/.pi/agent/package.json custom/config/extensions-package.json
```

### Phase 4: 迁移技能包和部署配置

```bash
# 1. 复制技能包
cp -r ~/.pi/packs/* packs/

# 2. 复制部署配置
cp -r ~/.pi/deploy/* deploy/

# 3. 复制便携配置
cp -r ~/.pi/portable/* portable/

# 4. 复制 SearXNG
cp -r ~/.pi/searxng/* searxng/
```

### Phase 5: 迁移文档

```bash
# 1. 复制文档
cp -r ~/.pi/docs/* docs/

# 2. 复制根文档
cp ~/.pi/README.md docs/PI-TOOLS-README.md
cp ~/.pi/CHANGELOG.md .
cp ~/.pi/FIX-REPORT.md docs/

# 3. 复制 CI 配置
cp -r ~/.pi/.github .github/
```

### Phase 6: 处理冲突和兼容性

```bash
# 1. 对比扩展差异
diff -r ~/.pi/agent/extensions/ custom/extensions/

# 2. 对比服务差异
diff -r ~/.pi/agent/services/ custom/services/

# 3. 对比脚本差异
diff ~/.pi/scripts/ scripts/

# 4. 合并配置差异
# 手动处理 settings.json 等配置文件的差异
```

### Phase 7: 整合文档

```bash
# 1. 整合 README.md
# 合并 pi-tools 的运维视角和 my-pi 的架构视角

# 2. 整合 AGENTS.md
# 保留 pi-tools 的中文版作为主要文档

# 3. 整合 custom/docs/
# 将 pi-tools 的文档移动到 docs/ 目录
```

## 五、冲突处理策略

### 5.1 扩展冲突

- **原则**：以 pi-tools 为准，因为 pi-tools 的扩展经过充分测试
- **方法**：直接覆盖 my-pi 的扩展
- **保留**：保留 my-pi 的 adapters/ 层和 services/ 下沉架构

### 5.2 服务冲突

- **原则**：合并两者，保留 my-pi 的下沉架构
- **方法**：
  - 将 pi-tools 的 services 移动到 custom/services/
  - 保留 my-pi 的 custom/src/services/ 下沉服务
  - 更新导入路径

### 5.3 脚本冲突

- **原则**：保留两者，分别放在不同目录
- **方法**：
  - pi-tools 脚本放在 scripts/core/, scripts/crash-recovery/, scripts/maintenance/
  - my-pi 脚本放在 scripts/ 根目录
  - 更新脚本中的路径引用

### 5.4 配置冲突

- **原则**：以 pi-tools 为准，因为 pi-tools 的配置经过实际使用验证
- **方法**：直接覆盖 my-pi 的配置
- **保留**：保留 my-pi 的 config/manager.ts 抽象层

### 5.5 文档冲突

- **原则**：整合两者，保留各自的独特内容
- **方法**：
  - 创建整合版 README.md
  - 保留 pi-tools 的运维文档
  - 保留 my-pi 的架构文档

## 六、多设备配置处理

### 6.1 配置差异

```bash
# 检查多设备配置差异
diff ~/.pi/agent/settings.json /path/to/other-device/.pi/agent/settings.json

# 检查 API 密钥差异
diff ~/.pi/agent/auth.json /path/to/other-device/.pi/agent/auth.json

# 检查模型配置差异
diff ~/.pi/agent/models.json /path/to/other-device/.pi/agent/models.json
```

### 6.2 配置同步

```bash
# 创建配置同步脚本
cat > scripts/sync-config.sh << 'EOF'
#!/bin/bash
# 同步多设备配置

SOURCE_DEVICE=$1
TARGET_DEVICE=$2

# 同步配置文件
rsync -av ~/.pi/agent/settings.json $TARGET_DEVICE/.pi/agent/
rsync -av ~/.pi/agent/modes.json $TARGET_DEVICE/.pi/agent/
rsync -av ~/.pi/agent/keybindings.json $TARGET_DEVICE/.pi/agent/

# 同步扩展
rsync -av ~/.pi/agent/extensions/ $TARGET_DEVICE/.pi/agent/extensions/

# 同步服务
rsync -av ~/.pi/agent/services/ $TARGET_DEVICE/.pi/agent/services/
EOF
```

## 七、远程仓库更新处理

### 7.1 检查远程更新

```bash
# 检查 pi-tools 远程更新
cd ~/.pi
git fetch origin
git log HEAD..origin/main --oneline

# 检查 pi 上游更新
cd /tmp/my-pi
git fetch upstream
git log HEAD..upstream/main --oneline
```

### 7.2 同步远程更新

```bash
# 同步 pi-tools 更新
cd ~/.pi
git pull origin main

# 同步 pi 上游更新
cd /tmp/my-pi
./scripts/sync-upstream.sh
```

## 八、数据未同步处理

### 8.1 检查未同步数据

```bash
# 检查 pi-tools 未提交的修改
cd ~/.pi
git status

# 检查 my-pi 未提交的修改
cd /tmp/my-pi
git status

# 检查运行时数据
ls -la ~/.pi/agent/sessions/
ls -la ~/.pi/agent/stats/
```

### 8.2 同步数据

```bash
# 同步会话数据
rsync -av ~/.pi/agent/sessions/ /tmp/my-pi/custom/sessions/

# 同步统计数据
rsync -av ~/.pi/agent/stats/ /tmp/my-pi/custom/stats/

# 同步日志数据
rsync -av ~/.pi/logs/ /tmp/my-pi/logs/
```

## 九、验证迁移

### 9.1 验证脚本

```bash
# 运行冒烟测试
./scripts/test/smoke-test.sh

# 运行完整测试
./scripts/test/test-all.sh

# 运行每日健康检查
node ./scripts/maintenance/daily-health.mjs
```

### 9.2 验证扩展

```bash
# 测试扩展加载
mypi --list-models

# 测试扩展功能
mypi -p "test extension loading"
```

### 9.3 验证配置

```bash
# 验证配置文件
cat custom/config/settings.json | python3 -m json.tool

# 验证扩展配置
cat custom/config/extensions-package.json | python3 -m json.tool
```

## 十、回滚方案

### 10.1 回滚迁移

```bash
# 如果迁移失败，可以回滚到迁移前的状态
git checkout HEAD -- .

# 或者恢复备份
cp -r /backup/my-pi /tmp/my-pi
```

### 10.2 部分回滚

```bash
# 如果只是某个部分失败，可以单独回滚
git checkout HEAD -- scripts/
git checkout HEAD -- custom/extensions/
git checkout HEAD -- custom/services/
```

## 十一、时间计划

| 阶段 | 任务 | 预计时间 |
|------|------|----------|
| Phase 1 | 迁移核心脚本 | 1 小时 |
| Phase 2 | 迁移扩展和服务 | 2 小时 |
| Phase 3 | 迁移配置 | 1 小时 |
| Phase 4 | 迁移技能包和部署配置 | 1 小时 |
| Phase 5 | 迁移文档 | 1 小时 |
| Phase 6 | 处理冲突和兼容性 | 2 小时 |
| Phase 7 | 整合文档 | 1 小时 |
| **总计** | | **9 小时** |

## 十二、风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 扩展兼容性问题 | 高 | 以 pi-tools 为准，直接覆盖 |
| 脚本路径错误 | 中 | 仔细检查路径引用 |
| 配置冲突 | 中 | 以 pi-tools 为准，手动合并 |
| 文档不一致 | 低 | 整合两者，保留独特内容 |
| 多设备配置差异 | 中 | 创建配置同步脚本 |
| 远程仓库更新 | 低 | 先检查远程更新，再迁移 |
| 数据未同步 | 中 | 先同步数据，再迁移 |
