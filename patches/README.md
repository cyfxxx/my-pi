# 补丁管理

本目录包含对 `vendor/pi/` 的修改补丁。每个补丁记录一个明确的修改。

## 文件结构

```
patches/
├── README.md                  # 本文件
├── 001-branding.patch         # 品牌化（name/piConfig）
├── 002-local-pi-mods.patch    # 本地 pi 源码改动
├── 003-tab-completion-fix.patch  # Tab 斜杠命令参数补全
└── 004-footer-tweaks.patch    # footer 增强（实时上下文/双缓存率/人民币成本/重启提示）
└── 005-footer-speed-and-scrollback.patch  # 速度并入 footer stats 行 + regular 模式保留 scrollback
└── 006-footer-cost-and-cache-window.patch  # 汇率可配置 + CH 右值改最近 20 轮滑动窗口
```

## 补丁命名规范

```
{序号}-{功能描述}.patch
```

## 现有补丁

| 补丁 | 作用 | 目标 |
|------|------|------|
| `001-branding.patch` | 将上游 monorepo 名称改为 `my-pi` 并写入 `piConfig` | `vendor/pi/package.json` |
| `002-local-pi-mods.patch` | 本地 pi 源码改动：项目级 `.pi` 发现、secrets 脱敏、Google `TOO_MANY_TOOL_CALLS`、离线跳过 model-data 校验、tsconfig 排除 `src/custom`、`packages/README.md` | `vendor/pi/packages/**` |
| `003-tab-completion-fix.patch` | `handleTabCompletion` 斜杠命令上下文统一走 `handleSlashCommandCompletion()`，使 `/voice`、`/plan` 等子命令参数补全在 Tab 时可见（对应 pi-tools `patch-tab-arg-completion.mjs`） | `vendor/pi/packages/tui/src/components/editor.ts` |
| `004-footer-tweaks.patch` | footer 增强（合并 pi-tools 四个 dist 补丁）：实时上下文 token 显示+双指标着色（黄=压缩参考线 `PI_CONTEXT_ABSOLUTE_TOKENS` 默认 256K，红=超窗口 80%）；CH 实时/会话双命中率；`Σ/↑/↓` 字段与人民币成本；>40% 窗口追加 `⚠` 重启提示 | `vendor/pi/packages/coding-agent/src/modes/interactive/components/footer.ts` |
| `005-footer-speed-and-scrollback.patch` | ① 输出速度（status key `tps`）并入 footer stats 行并沿用 dim 风格（此前为独立未着色行），其余扩展状态行统一 dim；② regular 模式 `fullRender(true)` 去掉 `ESC[3J`，宽度变化/内容收缩不再清空 scrollback（解决工作过程中无法向上滚动查看历史） | `vendor/pi/packages/coding-agent/src/modes/interactive/components/footer.ts`、`vendor/pi/packages/tui/src/tui-main-screen.ts` |
| `006-footer-cost-and-cache-window.patch` | ① 成本换算汇率 `CNY_PER_USD` 由硬编码 6.77 改为可配置（`PI_CNY_PER_USD`，默认 7.05）；② CH 右值由“会话累计命中率”改为“最近 20 轮滑动窗口命中率”——累计值被早期未命中轮次稀释（重启/压缩后首轮全量重发）长期停在 95% 附近，滑动窗口随上下文规模贴近真实健康度（正常 99%+） | `vendor/pi/packages/coding-agent/src/modes/interactive/components/footer.ts` |

## 验证补丁

要求 `vendor/pi/` 处于对应基线（`vendor/PINNED_COMMIT`）：

```bash
for p in patches/*.patch; do
  git -C vendor/pi apply --check "$p"
done
```

## 使用方法

补丁由 `scripts/sync-upstream.sh` 在同步上游后自动应用，或在引导时由 `scripts/build.sh` 应用：

```bash
bash scripts/sync-upstream.sh
```

## 最佳实践

1. **最小化修改**：只修改必要的代码
2. **清晰描述**：每个补丁都有清晰的作用说明
3. **及时更新**：上游同步后及时更新补丁
4. **定期清理**：删除不再需要的补丁
