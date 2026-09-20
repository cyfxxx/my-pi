# 故障排除指南

> 系统化的故障诊断流程，帮助快速定位和解决 my-pi 运行中的问题。

## 元信息

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 更新日期 | 2026-09-20 |
| 适用范围 | my-pi 运行时故障、扩展（custom/features）问题、配置问题 |
| 相关文档 | [FAQ.md](./FAQ.md), [operations/ENVIRONMENTS.md](./operations/ENVIRONMENTS.md), [development/PI-EXT-DEV-NOTES.md](./development/PI-EXT-DEV-NOTES.md) |

---

## 目录

- [一、通用诊断流程](#一通用诊断流程)
- [二、启动问题](#二启动问题)
- [三、扩展问题](#三扩展问题)
- [四、配置问题](#四配置问题)
- [五、网络问题](#五网络问题)
- [六、性能问题](#六性能问题)
- [七、数据问题](#七数据问题)
- [八、日志与工具输出](#八日志与工具输出)
- [九、获取帮助](#九获取帮助)

---

## 一、通用诊断流程

### 1. 快速检查清单

在项目根目录 `/root/my-pi` 下依次执行，任一环节失败即锁定故障层：

```bash
# 1. 检查 my-pi 版本（确认 CLI 可启动）
./my-pi.sh --version

# 2. 检查隔离边界（上游隔离 / 接口隔离）
npm run check

# 3. 检查 custom/ 类型（唯一需要维护的代码层）
npx tsc --noEmit -p custom/

# 4. 运行单元测试
npx vitest run

# 5. 校验 portable/agent/ 下所有 JSON 合法性
for f in portable/agent/*.json; do
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" \
    && echo "$f OK" || echo "$f BROKEN"
done
```

判读方式：

| 失败环节 | 指向的问题层 | 处理章节 |
|----------|--------------|----------|
| `--version` 无法输出 | vendor/pi 缺失或未构建 | §二 |
| `npm run check` 失败 | 隔离边界被破坏（features 直接 import vendor/pi） | §三 |
| `tsc` 报错 | custom/ 类型或上游 API 变更 | §三 |
| `vitest run` 失败 | 功能逻辑回归 | §六 |
| JSON BROKEN | 配置文件格式错误 | §四 |

### 2. 问题分类

| 问题类型 | 症状 | 首选文档 |
|----------|------|----------|
| 启动失败 | `./my-pi.sh` 无法启动 | 本文件 §二 |
| 扩展不工作 | 特定功能异常 | 本文件 §三 |
| 配置错误 | 配置不生效 | 本文件 §四 |
| 网络问题 | 连接失败 | 本文件 §五 |
| 性能问题 | 响应慢 | 本文件 §六 |
| 数据问题 | 记忆/会话异常 | 本文件 §七 |

### 3. 诊断纪律

- 先确认改动落在哪一层（`vendor/pi/` 只读、`custom/adapters/` 是唯一 Pi API 接触点、`custom/features/` 零 Pi 依赖、`portable/` 是运行时数据），再动手。
- 一次只改一个变量；改动后重跑上面对应的检查命令。
- 对难复现的 bug 或性能回退，使用 `pi-bug-diagnosis` 技能的分阶段纪律（先建反馈回路，禁止无回路直接猜假设）。

---

## 二、启动问题

### 2.1 vendor/pi 不存在或未构建

**症状：** `./my-pi.sh` 输出 `❌ 未找到 .../vendor/pi/packages/coding-agent/dist/cli.js`。

**原因：** `vendor/pi/` 是独立 git clone 且已被 gitignore，不随主仓库分发；fresh checkout 后必须先引导构建。

**解决：**
```bash
# 引导构建：自动 clone 上游、checkout vendor/PINNED_COMMIT、应用 patches/
bash scripts/build.sh

# 构建完成后重试启动
./my-pi.sh
```

**验证：**
```bash
# 确认上游锁定点存在
ls vendor/pi/PINNED_COMMIT vendor/pi/LAST_SYNC_POINT

# 确认构建产物存在
ls vendor/pi/packages/coding-agent/dist/cli.js
```

### 2.2 构建或上游同步失败

**症状：** `bash scripts/build.sh` 中途失败，通常在应用 `patches/` 阶段。

**原因：** `patches/` 中的补丁（`001-branding.patch`、`002-local-pi-mods.patch`）与当前 `vendor/PINNED_COMMIT` 不匹配。

**解决：**
```bash
# 同步到锁定的上游基线（不带参数则同步到最新上游）
bash scripts/sync-upstream.sh

# 同步到指定 commit
bash scripts/sync-upstream.sh <commit-sha>

# 重新构建
bash scripts/build.sh
```

`vendor/pi/` 永不直接修改；一切改动都经 `patches/` 管理，上游更新只走 `scripts/sync-upstream.sh`。

### 2.3 启动时报 JSON 解析错误

**症状：** 启动过程中报配置文件解析失败。

**原因：** `portable/agent/` 下的某个 JSON 被写坏（手工编辑、写入中断）。

**解决：**
```bash
# 定位损坏文件
for f in portable/agent/*.json; do
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" \
    && echo "$f OK" || echo "$f BROKEN"
done

# 跟踪的文件可从 git 恢复
git checkout HEAD -- portable/agent/settings.json
git checkout HEAD -- portable/agent/keybindings.json
```

**注意：** `auth.json`、`models.json`、`models-store.json`、`modes.json`、`trust.json` 为每环境独立且被 gitignore，无法从 git 恢复，只能由备份还原（见 §七，`pi-backup` 技能）。

---

## 三、扩展问题

my-pi 的功能以 `custom/features/` 下的模块提供，通过 `custom/bootstrap.ts` 统一注册，Pi API 只出现在 `custom/adapters/`。扩展排查始终围绕这三处。

### 3.1 功能未加载

**症状：** 某个功能（如 `plan-mode`、`subagent`、`memory`）完全不可用。

**诊断：**
```bash
# 1. 确认启动时加载了 bootstrap（my-pi.sh 已注入 --extension）
./my-pi.sh --version

# 2. 确认模块文件存在（每个模块含 index.ts + logic.ts）
ls custom/features/<模块名>/

# 3. 确认模块已在入口注册
grep -n "<模块名>" custom/bootstrap.ts

# 4. 类型检查
npx tsc --noEmit -p custom/
```

**解决：**
- 未注册：在 `custom/bootstrap.ts` 中补上注册（参照已注册模块的写法）。
- 文件缺失：从 `portable/agent/skills/` 或 `packs/` 中确认该功能是否本就未迁移，不要凭想象补文件。
- 模块名以 `ls custom/features/` 实际输出为准：`autopilot`、`browser`、`context`、`intervention`、`link`、`memory`、`mode`、`plan-mode`、`subagent`、`tmux`、`voice`、`web-search`。

### 3.2 加载时报错

**症状：** 启动时某个模块抛异常，或工具/钩子注册失败。

**原因：** 模块直接 import 了 `vendor/pi`（越过适配器层），或适配器签名与上游不一致。

**诊断：**
```bash
# 隔离边界检查：features 不得直接 import vendor/pi
npm run check

# 检查模块依赖方向：logic.ts 必须零 Pi 依赖
grep -rn "vendor/pi" custom/features/
grep -rn "vendor/pi" custom/adapters/ custom/core/
```

**解决：**
- 把 Pi API 调用从 `custom/features/*/` 移到 `custom/adapters/tool-adapter.ts`、`hook-adapter.ts`，features 只保留纯逻辑。
- 重新构建并重试：`bash scripts/build.sh`。
- 扩展开发细节见 [development/PI-EXT-DEV-NOTES.md](./development/PI-EXT-DEV-NOTES.md)。

### 3.3 上游更新后功能失效

**症状：** `scripts/sync-upstream.sh` 之后，原本正常的功能报错。

**原因：** 上游 Pi API 变更。设计上这类破坏只应波及适配器层。

**诊断：**
```bash
# 全量类型检查会直接指出签名不匹配的位置
npx tsc --noEmit -p custom/

# 单测覆盖纯逻辑，应保持全绿
npx vitest run
```

**解决：** 只修改 `custom/adapters/` 中的适配代码；若 `custom/features/*/logic.ts` 也需改动，说明依赖方向已被破坏，应先把 Pi 相关逻辑移回适配器。

---

## 四、配置问题

### 4.1 配置不生效

**症状：** 修改 `portable/agent/settings.json` 后行为没有变化。

**原因：** Pi 运行时配置目录未指向 `portable/agent`，或文件格式错误，或未重启进程。

**解决：**
```bash
# 1. 确认 PI_CODING_AGENT_DIR 指向 portable/agent
echo "$PI_CODING_AGENT_DIR"
# 期望：<项目根>/portable/agent（由 ./my-pi.sh 导出）

# 2. 校验 JSON 合法性
for f in portable/agent/*.json; do
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" \
    && echo "$f OK" || echo "$f BROKEN"
done

# 3. 修改配置后重启
./my-pi.sh
```

**关键事实：** pi 只识别 `PI_CODING_AGENT_DIR`（agentDir）与 `PI_PACKAGE_DIR`；技能、会话、扩展都挂在 agentDir 下，启动器**不再导出** `PI_SESSION_DIR`/`PI_SKILLS_DIR`/`PI_EXTENSION_DIR` 这类无效变量。`PI_MEMORY_DIR` 不由 pi 读取，而是 `custom/core/note-store.ts` 读取。会话目录若需覆盖，用 `PI_CODING_AGENT_SESSION_DIR` 或 `--session-dir`。

### 4.2 技能（skills）未发现

**症状：** `portable/agent/skills/<名称>/SKILL.md` 存在，但技能未生效。

**原因：** 技能由 `agentDir/skills` 自动发现，`agentDir` 即 `PI_CODING_AGENT_DIR`（`portable/agent`）；`settings.json` 中的 `skills` 数组是相对 `agentDir` 的覆盖模式，`+` 前缀表示强制启用。

**解决：**
```bash
# 确认技能文件位置
ls portable/agent/skills/<名称>/SKILL.md

# 确认 settings.json 中的启用项
node -e "console.log(JSON.parse(require('fs').readFileSync('portable/agent/settings.json','utf8')).skills)"

# 技能只从 agentDir/skills（= portable/agent/skills/）加载
```

### 4.3 多环境配置冲突

**症状：** 换设备或换环境后配置、凭据表现不一致。

**原因：** 部分配置文件跟踪入库，部分每环境独立。

**解决：**
```bash
# 跟踪的文件：settings.json / keybindings.json / AGENTS.md / APPEND_SYSTEM.md
git status portable/agent/

# 每环境独立的文件（gitignore，不入库、不随 git 同步）
ls -la portable/agent/auth.json \
       portable/agent/models.json \
       portable/agent/models-store.json \
       portable/agent/modes.json \
       portable/agent/trust.json

# 同步跟踪的配置
git pull --rebase origin master
```

跨环境约定与凭据分发详见 [operations/ENVIRONMENTS.md](./operations/ENVIRONMENTS.md)。

---

## 五、网络问题

### 5.1 API 连接失败

**症状：** 模型调用失败、超时或鉴权被拒。

**诊断：**
```bash
# 1. 检查到服务端的网络连通性
curl -I https://api.deepseek.com

# 2. 检查认证配置（每环境独立、gitignore）
ls -la portable/agent/auth.json

# 3. 检查默认 provider / model 与模型定义
node -e "const s=JSON.parse(require('fs').readFileSync('portable/agent/settings.json','utf8')); console.log(s.defaultProvider, s.defaultModel)"
node -e "JSON.parse(require('fs').readFileSync('portable/agent/models.json','utf8'))" && echo "models.json OK"
```

**解决：** 按错误类型区分——连接超时是网络/DNS 问题；401/403 是 `auth.json` 与 provider 不匹配；模型不存在是 `models.json` 与 `defaultModel` 不一致。

### 5.2 git 操作失败

**症状：** `git pull` / `git push` 被拒绝。

**解决：**
```bash
# 拉取最新（有本地提交时用 rebase）
git pull --rebase origin master

# 检查远程配置
git remote -v
```

**注意：** `vendor/pi/` 是独立 clone，remote 为上游 `earendil-works/pi-mono`。不要手动在 `vendor/pi/` 内 `git pull`，同步统一走 `bash scripts/sync-upstream.sh`。

### 5.3 npm 依赖安装失败

**症状：** `npm install` / `npx` 拉包失败。

**解决：**
```bash
# 确认 registry 配置
cat .npmrc

# 确认 Node 版本满足要求（package.json engines: >=22.19.0）
node --version

# 重新安装依赖（根目录 workspaces: custom）
npm install
```

---

## 六、性能问题

### 6.1 响应缓慢

**症状：** my-pi 响应时间明显变长。

**诊断：**
```bash
# 1. 检查会话数据规模
du -sh portable/agent/sessions/

# 2. 检查上下文/预算相关逻辑（custom/features/context/）
ls custom/features/context/

# 3. 检查工具输出归档大小（大输出会持续占用磁盘与读写时间）
du -sh portable/memory/tool-outputs/ 2>/dev/null
ls -lh portable/memory/tool-outputs/ 2>/dev/null | head
```

**优化：**
- 长会话及时开新会话，避免上下文无限累积。
- 清理 `portable/memory/tool-outputs/` 中不再需要的归档输出（清理前确认内容不再需要，且已被备份）。
- 若变慢与某次改动时间吻合，按 §3.3 的流程做类型与单测回归定位。

### 6.2 内存占用高

**症状：** 系统内存不足，Node 进程占用持续升高。

**诊断：**
```bash
# 检查 Node 进程内存
ps aux | grep node

# 检查会话与记忆数据规模
du -sh portable/agent/sessions/ portable/memory/
```

**解决：** 会话数据不会自动收缩，长期运行后应归档或清理 `portable/agent/sessions/`；清理前用 `pi-backup` 技能留档。

### 6.3 校验命令本身很慢

**症状：** `npm run check` / `npx tsc --noEmit -p custom/` / `npx vitest run` 耗时过长。

**说明：** 这三条命令覆盖隔离边界、类型、单测，是定位问题的第一手证据。若确实需要缩小范围，先确认改动只落在某个模块，再针对该模块单独排查；不要因为慢而跳过检查环节。

---

## 七、数据问题

运行时数据全部收敛在 `portable/`：`portable/agent/`（agentDir：Pi 配置、`skills/` 技能、`sessions/` 会话、`extensions/` 第三方扩展）、`portable/memory/`（自定义功能数据：note-store 笔记 + `tool-outputs/` 归档）。

### 7.1 记忆数据异常

**症状：** 记忆搜索失败、笔记读取报错。

**诊断：**
```bash
# 检查记忆目录
ls -la portable/memory/

# 检查其中的 JSON 是否可解析
find portable/memory -maxdepth 1 -name '*.json' -print0 2>/dev/null | \
  while IFS= read -r -d '' f; do
    node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" \
      && echo "$f OK" || echo "$f BROKEN"
  done

# 记忆读写逻辑位于 note-store 与 memory 功能模块
ls custom/core/note-store.ts custom/features/memory/
```

**恢复：** 使用 `pi-backup` 技能从备份还原对应数据。`portable/memory/` 被 gitignore，git 不能作为恢复来源。

### 7.2 会话历史丢失

**症状：** 无法恢复之前的会话。

**原因：** 会话文件被删除、损坏，或会话目录被误清理。

**预防：**
```bash
# 检查会话目录
ls -la portable/agent/sessions/

# 定期备份（含会话）——使用 pi-backup 技能
# 技能位置：portable/agent/skills/pi-backup/
```

**注意：** `portable/agent/sessions/` 被 gitignore，删除后无法从 git 找回；会话数据的唯一保险是备份。

---

## 八、日志与工具输出

my-pi 没有独立的日志目录，诊断信息来自三个可观测面：

```bash
# 1. 启动与运行时的错误直接打印在调用终端
./my-pi.sh

# 2. 工具输出归档（大输出的落盘位置）
ls -lh portable/memory/tool-outputs/
du -sh portable/memory/tool-outputs/

# 3. 检查/构建命令的输出
npm run check
npx tsc --noEmit -p custom/
npx vitest run
```

排查建议：
- 报错时先保留**完整**的终端输出，不要只截最后一行。
- 只用命令的实际输出作为证据；不要假设存在某个日志文件或调试开关。
- 需要更细粒度的诊断时，使用 `pi-bug-diagnosis` 技能的插桩纪律：一次只改一个变量，每条日志打唯一前缀，问题定位后立即移除插桩。

---

## 九、获取帮助

### 9.1 社区资源

- Pi 官方文档: https://pi.dev/docs/latest
- GitHub Issues: https://github.com/earendil-works/pi-coding-agent/issues

### 9.2 本地资源

| 资源 | 内容 |
|------|------|
| [README.md](./README.md) | 文档索引与阅读顺序 |
| [FAQ.md](./FAQ.md) | 常见问题速查 |
| [development/PI-EXT-DEV-NOTES.md](./development/PI-EXT-DEV-NOTES.md) | 扩展开发与适配器约定 |
| [operations/ENVIRONMENTS.md](./operations/ENVIRONMENTS.md) | 多环境与配置分发 |
| `pi-bug-diagnosis` 技能 | 难复现 bug 与性能回退的分阶段诊断纪律 |

### 9.3 报告问题

报告问题时请包含：

1. **环境信息**：`uname -a`、`./my-pi.sh --version`、`node --version`
2. **错误信息**：完整的错误输出（含触发它的命令）
3. **复现步骤**：如何触发问题，是否稳定复现
4. **检查结果**：`npm run check`、`npx tsc --noEmit -p custom/`、`npx vitest run` 的输出
5. **相关数据**：涉及记忆/会话时，说明 `portable/memory/` 或 `portable/agent/sessions/` 的异常现象（注意脱敏，凭据类内容替换为 `<REDACTED>`）
