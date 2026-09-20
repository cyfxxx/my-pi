# 常见问题

> 收集用户常见问题和简短回答，便于快速查阅。

## 元信息

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 更新日期 | 2026-09-20 |
| 适用范围 | my-pi 使用常见问题 |
| 相关文档 | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md), [README.md](../README.md) |

---

## 目录

- [一、安装与配置](#一安装与配置)
- [二、使用问题](#二使用问题)
- [三、功能与技能](#三功能与技能)
- [四、数据与备份](#四数据与备份)
- [五、性能优化](#五性能优化)
- [六、其他](#六其他)

---

## 一、安装与配置

### Q: 如何安装 my-pi？

```bash
git clone <仓库地址> /root/my-pi
cd /root/my-pi
bash scripts/build.sh
```

`scripts/build.sh` 会引导 `vendor/pi`（fresh checkout 时自动 clone 上游、checkout
`vendor/PINNED_COMMIT` 并应用 `patches/`），然后构建 coding-agent 与 `custom/`。

### Q: 如何启动？

```bash
./my-pi.sh          # 便携启动脚本：自动解析项目根目录并注入路径变量
```

开发模式（tsx 直接运行 TS，不依赖构建产物）：

```bash
bash scripts/dev.sh
```

### Q: 如何更新 my-pi？

```bash
cd /root/my-pi && git pull
bash scripts/sync-upstream.sh        # 同步 vendor/pi 到最新上游
bash scripts/build.sh
```

`scripts/sync-upstream.sh` 也接受指定 commit：`bash scripts/sync-upstream.sh <commit-sha>`。

### Q: 如何配置模型？

编辑 `portable/config/settings.json`，配置 `defaultProvider` 与 `defaultModel` 字段。

详见 [ENVIRONMENTS.md](./operations/ENVIRONMENTS.md)

### Q: 如何配置 API 密钥？

编辑 `portable/config/auth.json`：

```json
{
  "deepseek": "your-api-key"
}
```

> ⚠ 密钥文件已 gitignore，不要提交到仓库。

---

## 二、使用问题

### Q: 如何备份 my-pi？

```bash
# 本地归档（tar.gz）
pi-backup create

# GitHub 同步（git commit + push）
pi-backup sync
```

详见 [pi-backup SKILL.md](../portable/config/skills/pi-backup/SKILL.md)

### Q: 如何恢复？

```bash
pi-backup list                      # 查看可用备份
pi-backup restore --backup <路径>   # 从本地归档恢复到仓库根
```

会话历史默认不恢复，需要时加 `--include-sessions`。

### Q: 如何切换运行模式？

模式由环境变量 `PI_AGENT_MODE` 控制，取值为 `full`（默认，全部功能）、`light`
（仅 web-search 与 plan-mode）、`quick`（仅内置工具）；模式配置定义在
`custom/features/mode/logic.ts`。

### Q: 如何压缩上下文？

```bash
pi /compact                 # 内置命令，手动压缩会话上下文
```

压缩阈值在 `portable/config/settings.json` 的 `compaction` 字段（`reserveTokens` /
`keepRecentTokens`）。

### Q: 如何重载配置与技能？

```bash
pi /reload                  # 重载 keybindings、功能、技能、提示词与上下文文件
```

---

## 三、功能与技能

### Q: my-pi 有哪些内置功能？

12 个功能模块位于 `custom/features/`，由 `custom/bootstrap.ts` 统一注册：
autopilot、browser、context、intervention、link、memory、mode、plan-mode、
subagent、tmux、voice、web-search。

### Q: 如何开发新功能？

新功能放在 `custom/features/<name>/`：`logic.ts` 保持零 Pi 依赖，通过
`custom/adapters/` 与 Pi 交互，最后在 `custom/bootstrap.ts` 的 `FEATURES` 中注册。

详见 [PI-EXT-DEV-NOTES.md](./development/PI-EXT-DEV-NOTES.md) 与
[PI-SDK-EXTENSION.md](./development/PI-SDK-EXTENSION.md)

### Q: 技能放在哪里？

技能位于 `portable/config/skills/<name>/SKILL.md`（pi 自动发现），当前内置
`pi-backup`、`pi-bug-diagnosis`、`pi-full-audit`、`pi-translate-zh`。
`portable/config/settings.json` 的 `skills` 数组用于覆盖启用（`+` 前缀强制启用）。

### Q: packs 是什么？

`packs/` 是外部技能包仓库，按需加载，**不注入系统提示词**。需要时手动读取
`packs/<name>/SKILL.md`，不要放入 `portable/config/skills/`（防系统提示词膨胀）。

---

## 四、数据与备份

### Q: 记忆数据在哪里？

`portable/memory/notes.json`（note-store 持久记忆，gitignore，必须靠归档带走）。
笔记由 memory 功能在会话中自动维护，并在会话启动时报告统计。

### Q: 如何导出记忆？

```bash
pi-backup create            # 归档默认包含 portable/memory/notes.json
```

### Q: 如何清理旧记忆？

按需编辑 `portable/memory/notes.json`；memory 功能自带自动回收逻辑
（`custom/features/memory/logic.ts` 的 `autoReclaim`）会清理过期条目。

### Q: 会话历史在哪里？

`portable/sessions/`（gitignored）。

---

## 五、性能优化

### Q: 如何提高响应速度？

1. 使用 `pi /compact` 压缩上下文
2. 检查上下文预算与工具输出占用：`custom/features/context/budget.ts` 的预算报告
3. 优化工具输出：调整 `custom/features/context/` 的归档与裁剪阈值
   （归档落在 `portable/memory/tool-outputs/`）

### Q: 缓存命中率低怎么办？

检查 system prompt 注入面是否引入易变内容：按
[portable/config/AGENTS.md](../portable/config/AGENTS.md) 的约定，注入禁止时间戳与
精确数值（缓存友好）。

### Q: 如何监控资源使用？

会话启动时 memory 功能会提示当前笔记与记忆数量；上下文预算与工具调用耗时由
`custom/features/context/` 记录。

---

## 六、其他

### Q: 如何报告问题？

1. 检查 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. 提供环境信息、错误信息、复现步骤

### Q: 如何添加第三方扩展？

三种方式（安装位置以 vendor 源码为准）：

| 方式 | 命令 / 位置 |
|------|------------|
| npm 包 | `./my-pi.sh install npm:@foo/bar` → 装到 `portable/config/npm/node_modules/` |
| git 仓库 | `./my-pi.sh install git:github.com/user/repo` → 装到 `portable/config/git/<host>/<path>` |
| 本地单文件/目录 | 放到 `portable/config/extensions/<name>/`（= `agentDir/extensions`，自动发现，无需登记） |

`install` 会把来源写入 `portable/config/settings.json` 的 `packages`；用 `./my-pi.sh list` 查看、`./my-pi.sh remove <source>` 卸载。

注意：不要用 `-l/--local`——项目级配置目录由 coding-agent 的 `piConfig.configDir` 决定，运行时是 `.pi`，会在仓库根产生 `.pi/`。安装/卸载会改动 `packages` 从而改变 system prompt 前缀、导致缓存前缀断裂，属低频操作。

### Q: 如何自己改 my-pi 的功能？

见 [PI-EXT-DEV-NOTES.md](./development/PI-EXT-DEV-NOTES.md)：在 `custom/features/<name>/` 下按 `logic.ts`（纯逻辑，零 Pi 依赖）+ `index.ts`（经 `custom/adapters/` 注册）新增，并在 `custom/bootstrap.ts` 的 `FEATURES` 中登记。

### Q: 如何验证改动？

```bash
npm run check               # 隔离边界验证
npx tsc --noEmit -p custom/ # 类型检查
npx vitest run              # 单元测试
```

### Q: 文档在哪里？

文档入口为 [docs/README.md](./README.md)，结构说明见
[STRUCTURE.md](../STRUCTURE.md)。
