# 常见问题

> 收集用户常见问题和简短回答，便于快速查阅。

## 元信息

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 更新日期 | 2026-09-25 |
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
`vendor/PINNED_COMMIT` 并应用 `patches/`），然后构建 coding-agent。`custom/` 不编译——pi 的扩展加载器直接加载 `custom/bootstrap.ts`。

### Q: 如何启动？

```bash
./my-pi.sh          # 便携启动脚本：自动解析项目根目录并注入路径变量
```

浏览器访问（手机/远程）：

```bash
npm run web         # 或 bash scripts/web-terminal.sh
```

打印出带一次性令牌的地址，浏览器打开即可；服务只监听 `127.0.0.1`，远程先建隧道
（`ssh -N -L 7717:127.0.0.1:7717 <user>@<host>`）。首次用令牌换过 cookie 后，**同一端口重启
不需要重新授权**（把 `http://127.0.0.1:7717/` 加书签即可；换端口则要重新授权一次）。日常常驻
与停止方式（tmux / Ctrl-C）见 [custom/web-terminal/README.md](../custom/web-terminal/README.md)
的「常驻与停止」，用法与安全模型同文档。

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

编辑 `portable/agent/settings.json`，配置 `defaultProvider` 与 `defaultModel` 字段。

详见 [ENVIRONMENTS.md](./operations/ENVIRONMENTS.md)

### Q: 如何配置 API 密钥？

编辑 `portable/agent/auth.json`：

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

详见 [pi-backup SKILL.md](../portable/agent/skills/pi-backup/SKILL.md)

记忆与会话另可用 age 加密同步（跨设备，密文入库、私钥不入库）：

```bash
bash scripts/sync-memory.sh status   # 私钥/公钥指纹/密文状态
bash scripts/sync-memory.sh push     # 重新加密并写入 sync/memory.tar.age
bash scripts/sync-memory.sh pull     # 从密文恢复到 portable/
bash scripts/sync-memory.sh verify   # 校验可解密性 + 公钥一致 + 清单一致 + JSON 有效
```

### Q: 如何恢复？

```bash
pi-backup list                      # 查看可用备份
pi-backup restore --backup <路径>   # 从本地归档恢复到仓库根
```

会话历史默认不恢复，需要时加 `--include-sessions`。

### Q: 如何切换运行模式？

在会话里用 `/mode <名称>`（`/mode list` 看全部）。模式**只作用于当前会话**：新会话用
`portable/agent/modes.json` 的 `default`，续接会话自动回到它自己上次的模式（对应关系存在
`portable/agent/modes-sessions.json`，不入库）。可用档位：`full`（默认，全部功能）、`minimal`
（仅内置工具，无自定义功能；测试/修复用）、`roleplay`（标枪人设，秘书舰·已誓约：web-search +
隔离记忆 + 8 张形象参考图）或 `lean`（去掉 browser/voice/link/autopilot，成本敏感会话）。功能集/人设变更需要重启，
`/mode` 会自动重启并续接当前会话；也可以用环境变量 `PI_AGENT_MODE=<名称>` 强制覆盖整次运行
（跳过按会话解析与一致性校验，供测试/临时使用）。

切换完成后，重启回来的进程会按新模式注入一条 `[模式] 已切换：A → B` 的通知（说明功能面、
思考档位、人设与记忆命名空间），并要求模型不要向用户复述——角色扮演下不会破戏。
**同时跑多个 my-pi 实例**（例如 tmux 一个 + web 终端一个）是受支持的：重启请求带 `ownerPid`，
只有拉起该会话的实例会执行它；`modes-sessions.json` 与防环标记有跨进程锁保护。但**同一个会话文件
被两个实例同时打开**仍会互相覆盖（历史/模式），建议一个会话只在一个实例里用。
`node scripts/state-audit.mjs` 会提示当前有几个实例在跑。

这条通知走**零成本通道**（`deliverAs:'nextTurn'`）：不会触发模型回合，只在你下一次说话时
作为上下文出现；**重启后要不要自动接着干活**由 `custom/core/restart-intent.ts` 判（写入端声明
的意图 → 会话盘面最后一条是不是"工作在途"），可用 `PI_RESTART_RESUME=off` 一律不自动继续、
`=always` 一律继续（默认 `auto`）。
如果你遇到"切了模式但进程直接退出、模式没换"，那是 2026-10-06 修掉的一个 bug（重启请求被
重启通知的消费顺手取消，见 `DECISIONS.md`）；现在应表现为自动重启一次并注入上述通知。

### Q: 角色扮演模式的形象参考图在哪？怎么加图？

在 `portable/agent/modes/assets/roleplay/`（8 张精选代表图 + `README.md` 清单，含来源与识别提示）。
人设 `portable/agent/modes/roleplay.md` 的《形象参考图》一节把每张图的视觉常量写成了文字，
所以**纯文本模型也能用**；模型支持图片输入时，它可以按需 `read` 某一张看细节（`read` 支持 png/jpg/webp/gif）。
加图/换图要同时改人设清单和 `assets/roleplay/README.md`，否则 `bash scripts/check-conventions.sh`
的 E 节会拦下（悬空引用 / 孤儿资产 / 目录超 8 MB 三类都在守门范围内）。

### Q: 如何压缩上下文？

```bash
pi /compact                 # 内置命令，手动压缩会话上下文
```

压缩阈值在 `portable/agent/settings.json` 的 `compaction` 字段（`reserveTokens` /
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

此外还有一个**接入通道**（不是扩展）：`custom/web-terminal/` 让你能用浏览器访问同一个 TUI。

### Q: 如何开发新功能？

新功能放在 `custom/features/<name>/`：`logic.ts` 保持零 Pi 依赖，通过
`custom/adapters/` 与 Pi 交互，最后在 `custom/bootstrap.ts` 的 `FEATURES` 中注册。

详见 [PI-EXT-DEV-NOTES.md](./development/PI-EXT-DEV-NOTES.md) 与
[PI-SDK-EXTENSION.md](./development/PI-SDK-EXTENSION.md)

### Q: 技能放在哪里？

技能位于 `portable/agent/skills/<name>/SKILL.md`（pi 自动发现），当前内置
`pi-backup`、`pi-bug-diagnosis`、`pi-full-audit`、`pi-translate-zh`。
`portable/agent/settings.json` 的 `skills` 数组用于覆盖启用（`+` 前缀强制启用）。

### Q: packs 是什么？

`packs/` 是外部技能包仓库，按需加载，**不注入系统提示词**。需要时手动读取
`packs/<name>/SKILL.md`，不要放入 `portable/agent/skills/`（防系统提示词膨胀）。

---

## 四、数据与备份

### Q: 记忆数据在哪里？

`portable/memory/notes.json`（memory 功能的持久笔记，gitignore，必须靠归档带走）。
笔记由 memory 功能在会话中自动维护，并在会话启动时报告统计。

### Q: 如何导出记忆？

```bash
pi-backup create            # 归档默认包含 portable/memory/notes.json
```

### Q: 如何清理旧记忆？

先看**只读**候选清单（不修改任何数据）：

```bash
/memory lifecycle                              # 会话内
bash scripts/run-ts.sh scripts/memory-lifecycle.mjs --json   # headless / 脚本
```

报告给出淘汰候选（>180 天且低复现低置信）、升格候选、冲突嫌疑、垃圾嫌疑、聚合候选。
删除/合并/归纳都是写操作，**必须用户确认后执行**（`/memory prune` 清理过期条目）。
TTL 笔记另有自动回收（`notes.json`）。

### Q: 会话历史在哪里？

`portable/agent/sessions/`（gitignored）。

---

## 五、性能优化

### Q: 如何提高响应速度？

1. 上下文成本主要是「每请求都为全量上下文计费」，而不是压缩次数：注意
   **确定性擦除（旧 thinking / 旧工具输出）默认是关闭的**（`PI_CONTEXT_ERASE=on` 才开启）。
   它会改写历史前部，使其后整段前缀缓存失效，而缓存读单价只有全价的 1/50，因此
   **剪枝通常是净亏**——实测它占单个会话成本的 67%。用 `/context usage` 看预算与阈值占比。
2. 长会话确需压缩时用 `/compact`；压缩会发一次全价摘要请求，是否划算取决于后续轮数
   （见 [CONTEXT-MANAGEMENT-COMPARISON.md](development/CONTEXT-MANAGEMENT-COMPARISON.md)）。
3. **不要动 thinking 档位**：DeepSeek 的前缀缓存键包含 `reasoning_effort`，切档会使整段
   前缀失效（实测切档后 `cacheRead` 归零，下一次请求全价重算）。自动切档默认已关闭
   （`PI_CONTEXT_THINKING_AUTO=on` 开启），运行时档位被 `PI_THINKING_MAX_LEVEL`（默认
   `high`）夹住，避免切到 `deepseek-flash` 时被自动抬到 `max` 白烧 reasoning token。
4. 想知道钱花在哪：`node scripts/daily-health.mjs --print` 给出加权命中率、未命中每次、
   输出占比与**前缀前端变更次数**；前端变更每一次都等于一次整段重算。
5. 工具输出归档/裁剪阈值可用 `PI_CONTEXT_*` 调整（见
   [custom/features/context/README.md](../custom/features/context/README.md)），归档落在
   `portable/memory/tool-outputs/`（14 天/200MB 自动清理）。

### Q: 缓存命中率低怎么办？

1. 先归因：用 `/context fingerprint`（或 `portable/memory/logs/prefix-fingerprints.jsonl`）
   看 `changed` 字段——`system`/`tools` 变化说明前缀最前处变了；仅 `messages` 变化说明是
   压缩/擦除/注入位移；`sinceLastMs` 很大则属空闲后 provider 侧缓存失效。
2. 再检查注入面是否引入易变内容：按
   [portable/agent/AGENTS.md](../portable/agent/AGENTS.md) 的约定，注入禁止时间戳与
   精确数值（缓存友好）；静态基线由 `bash scripts/check-injection-surface.sh` 守门。

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
| npm 包 | `./my-pi.sh install npm:@foo/bar` → 装到 `portable/agent/npm/node_modules/` |
| git 仓库 | `./my-pi.sh install git:github.com/user/repo` → 装到 `portable/agent/git/<host>/<path>` |
| 本地单文件/目录 | 放到 `portable/agent/extensions/<name>/`（= `agentDir/extensions`，自动发现，无需登记） |

`install` 会把来源写入 `portable/agent/settings.json` 的 `packages`；用 `./my-pi.sh list` 查看、`./my-pi.sh remove <source>` 卸载。

注意：不要用 `-l/--local`——项目级配置目录由 coding-agent 的 `piConfig.configDir` 决定，运行时是 `.pi`，会在仓库根产生 `.pi/`。安装/卸载会改动 `packages` 从而改变 system prompt 前缀、导致缓存前缀断裂，属低频操作。

### Q: 如何自己改 my-pi 的功能？

见 [PI-EXT-DEV-NOTES.md](./development/PI-EXT-DEV-NOTES.md)：在 `custom/features/<name>/` 下按 `logic.ts`（纯逻辑，零 Pi 依赖）+ `index.ts`（经 `custom/adapters/` 注册）新增，并在 `custom/bootstrap.ts` 的 `FEATURES` 中登记。

### Q: 如何验证改动？

```bash
npm run check                 # 隔离边界验证
npx tsc --noEmit -p custom/   # 类型检查
npx vitest run                # 单元测试
npm run golden                # 行为防退化基准（19 步；--fast 仅结构守门，--smoke 加无头冒烟；
                              # 第 19 步真实模式切换场景默认跳过，PI_GOLDEN_SCENARIO=1 开启）
bash scripts/install-hooks.sh # 启用 git 钩子（提交前自动跑上述快检）
```

### Q: 文档在哪里？

文档入口为 [docs/README.md](./README.md)，结构说明见
[STRUCTURE.md](../STRUCTURE.md)。
