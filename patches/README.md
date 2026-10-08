# 补丁管理

本目录包含对 `vendor/pi/` 的修改补丁。每个补丁记录一个明确的修改。

## 文件结构

```
patches/
├── README.md                  # 本文件
├── 001-branding.patch         # 品牌化（name/piConfig）
├── 002-local-pi-mods.patch    # 本地 pi 源码改动
├── 003-tab-completion-fix.patch  # Tab 斜杠命令参数补全
├── 004-footer-tweaks.patch    # footer 增强（实时上下文/双缓存率/人民币成本/重启提示）
├── 005-footer-speed-and-scrollback.patch  # 速度并入 footer stats 行 + regular 模式保留 scrollback
├── 006-footer-cost-and-cache-window.patch  # 汇率可配置 + CH 右值改最近 20 轮滑动窗口
├── 007-footer-reorder.patch   # stats 行重排 + 去掉 ↑未命中 + CH 收敛为会话累计单值
├── 008-footer-cache-var-cleanup.patch  # 清理 007 遗留的 latestCacheHitRate 引用（修复 tsc 编译）
├── 009-footer-badge.patch     # footer 第一行 badge：`badge:` 前缀状态渲染到 pwd/branch 旁
├── 010-disable-share-bug.patch    # 禁用 `/share` 与 `/bug`（私人助手不外发会话内容）
└── 011-tool-search-cjk.patch      # tool_search 分词补 CJK 2 字 bigram（中文 query 检索得到 deferred 工具）
```

## 补丁命名规范

```
{序号}-{功能描述}.patch
```

## 现有补丁

| 补丁 | 作用 | 目标 |
|------|------|------|
| `001-branding.patch` | 将上游 monorepo 名称改为 `my-pi` 并写入 `piConfig` | `vendor/pi/package.json` |
| `002-local-pi-mods.patch` | 本地 pi 源码改动：secrets 脱敏、离线跳过 model-data 校验、tsconfig 排除 `src/custom`、`packages/README.md` | `vendor/pi/packages/**` |
| `003-tab-completion-fix.patch` | `handleTabCompletion` 斜杠命令上下文统一走 `handleSlashCommandCompletion()`，使 `/voice`、`/plan` 等子命令参数补全在 Tab 时可见（对应 pi-tools `patch-tab-arg-completion.mjs`） | `vendor/pi/packages/tui/src/components/editor.ts` |
| `004-footer-tweaks.patch` | footer 增强（合并 pi-tools 四个 dist 补丁）：实时上下文 token 显示+双指标着色（黄=压缩参考线 `PI_CONTEXT_ABSOLUTE_TOKENS` 默认 256K，红=超窗口 80%）；CH 实时/会话双命中率；`Σ/↑/↓` 字段与人民币成本；>40% 窗口追加 `⚠` 重启提示 | `vendor/pi/packages/coding-agent/src/modes/interactive/components/footer.ts` |
| `005-footer-speed-and-scrollback.patch` | ① 输出速度（status key `tps`）并入 footer stats 行并沿用 dim 风格（此前为独立未着色行），其余扩展状态行统一 dim；② regular 模式 `fullRender(true)` 去掉 `ESC[3J`，宽度变化/内容收缩不再清空 scrollback（解决工作过程中无法向上滚动查看历史） | `vendor/pi/packages/coding-agent/src/modes/interactive/components/footer.ts`、`vendor/pi/packages/tui/src/tui-main-screen.ts` |
| `006-footer-cost-and-cache-window.patch` | ① 成本换算汇率 `CNY_PER_USD` 由硬编码 6.77 改为可配置（`PI_CNY_PER_USD`，默认 7.05）；② CH 右值由“会话累计命中率”改为“最近 20 轮滑动窗口命中率”——累计值被早期未命中轮次稀释（重启/压缩后首轮全量重发）长期停在 95% 附近，滑动窗口随上下文规模贴近真实健康度（正常 99%+） | `vendor/pi/packages/coding-agent/src/modes/interactive/components/footer.ts` |
| `007-footer-reorder.patch` | footer stats 行顺序定为 `Σ总输入 → ↓输出 → CH会话累计 → ¥费用 → 上下文 → ⇅速度`（速度移末位并自带 dim，抵消上下文色码 reset）；移除与 Σ 重复的 `↑` 未命中；CH 由「最近一轮/20 轮窗口」双值收敛为单一会话累计命中率 | `vendor/pi/packages/coding-agent/src/modes/interactive/components/footer.ts` |
| `008-footer-cache-var-cleanup.patch` | 007 删除了 `latestCacheHitRate` 的声明与赋值，但漏删 `SessionStats` 接口字段、stats 对象属性与 render 解构三处引用，导致 `tsc` 报 TS18004；本补丁补齐删除 | `vendor/pi/packages/coding-agent/src/modes/interactive/components/footer.ts` |
| `009-footer-badge.patch` | **footer 第一行的常驻模式标识**：扩展状态 key 以 `badge:` 前缀注册时，剥离前缀后用 `warning` 色渲染在 `~/my-pi (main)` 之后（其余 key 仍走第三行状态行）。动机：计划模式是强只读约束，此前进入后仅一次性 `notify`（提示一滚走就无从判断），`/plan status` 又要主动查询；模式标识与「当前目录/分支」同属会话级状态，应常驻在 pwd 行。用前缀而非白名单，后续模式（roleplay 等）可零改动复用。当前消费方：`custom/features/plan-mode`（`badge:plan`） | `vendor/pi/packages/coding-agent/src/modes/interactive/components/footer.ts` |
| `010-disable-share-bug.patch` | 禁用 `/share`（会话上传 Radius 网关/GitHub gist）与 `/bug`（诊断上传 Earendil）：命令表删除两项，两个 handler 早退并提示已禁用，崩溃提示改为只指向本地调试日志。动机：私人助手不允许把会话内容发往外部 | `vendor/pi/packages/coding-agent/src/core/slash-commands.ts`、`vendor/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts` |
| `011-tool-search-cjk.patch` | **让 `tool_search` 的分词认识中文**：上游 `tokenize` 是 `toLowerCase().split(/[^a-z0-9]+/)`，**非 a-z0-9 一律当分隔符**，于是 CJK 全部被丢掉——中文工具描述只贡献它的英文标识符与参数名（实测 `browser_screenshot` 的检索文档只剩 6 个词），中文 query 更是得到 **0 个词**、`tool_search` 永远答 "No matching tools found."。而 deferred 工具恰恰是模型**没被告知过**的工具，它不可能改用英文名去搜，所以这条链在中文优先环境里等于不可用（实测 5/5 真实中文 query 无结果）。补丁给 CJK 连续段补 2 字 bigram（英文路径完全不变），实测 7 个中文 query 中 6 个命中正确工具。动机：browser 的 18 个工具改走 `exposure: 'deferred'`（注册但不声明 = 0 前缀字节）后，必须靠 `tool_search` 按需拉出 | `vendor/pi/packages/coding-agent/src/extensions/tool-search/tool.ts` |

## 验证补丁

要求 `vendor/pi/` 处于对应基线（`vendor/PINNED_COMMIT`）：

```bash
bash scripts/check-features.sh          # 补丁可应用或已应用（含顺序叠加场景）
bash scripts/golden-tasks.sh --fast     # 同上 + 补丁行为标记守门
```

> 不要用 `git apply --check --reverse` 逐个判定：004–009 都改 `footer.ts`，顺序叠加后
> 单个补丁的 reverse-check 会假失败。判定以**提交历史**为准（`scripts/lib-vendor.sh` 的
> `vendor_patch_applied`，匹配 `local: NNN-*` 本地提交）；行为是否还在由
> `scripts/check-patches-behavior.mjs` 断言关键符号/自标记——因此**每个补丁都必须在改动处写
> `Patch (NNN-name):` 自标记注释并说明理由**，没有标记的补丁在行为守门里等于没有防线。

## 使用方法

补丁由 `scripts/sync-upstream.sh` 在同步上游后自动应用，或在引导时由 `scripts/build.sh` 应用：

```bash
bash scripts/check-upstream.sh    # 先体检：目标基线会不会让补丁失配（只读）
bash scripts/sync-upstream.sh
```

上游同步前先体检、同步后如何验证、以及「上游出现了不想要的变更怎么办」，
见 [../docs/operations/UPSTREAM-UPDATE.md](../docs/operations/UPSTREAM-UPDATE.md)。

## 最佳实践

1. **最小化修改**：只修改必要的代码
2. **清晰描述**：每个补丁都有清晰的作用说明
3. **写自标记注释**：`Patch (NNN-name):` + 问题与取舍（行为守门的唯一锚点）
4. **及时更新**：上游同步后及时更新补丁
5. **定期清理**：删除不再需要的补丁（清理前先查 `DECISIONS.md` 里它为什么存在）
