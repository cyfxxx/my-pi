# 分支处理：三条与 DSH 有关的线怎么收

> 现状（2026-10-19）：
> - `main` = 回退后的主线（`f15d06bd7`，DSH 相关东西已从 main 移除/归档）
> - `archive/dsh-on-main` = `4453d3965`（把 DSH 硬塞进 main 的那条历史，仅作回退参照）
> - `feat/base-switch-dsh` = `dcdc3dfe2` = tag `v1.3.0-dsh`（换底座的实验线，已被 `feat/private-assistant` 取代）
> - `feat/private-assistant`（当前工作分支，22+ 提交，21 项验收全绿）

## 1. 判断标准

一条分支该留还是该删，看三件事：

1. **它是否还有独有提交**（没有 = 纯历史包袱）；
2. **它是否被 tag 钉住**（删分支不删 tag，历史不会丢）；
3. **回退文档是否还指向它**（`docs/design/DSH-ROLLBACK.md`）。

## 2. 建议的收法

| 分支 | 处置 | 理由 |
|---|---|---|
| `main` | **保留**，等 `feat/private-assistant` 合并 | 主线 |
| `feat/private-assistant` | **合并到 main 后保留一段时间**（或删掉，靠 tag 找回） | 它是这条新架构的唯一出口 |
| `feat/base-switch-dsh` | **删分支**（`v1.3.0-dsh` tag 已钉住） | 已被取代：它的目的（换底座）由 private-assistant 完成且更彻底 |
| `archive/dsh-on-main` | **删分支，保留 tag**（或改名为 tag `archive/dsh-on-main`） | 它只是"当时硬塞进 main"的快照；回退文档引用的是提交号 |

### 具体命令（合并之后执行）

```bash
# 0) 先确认没有未推送的独有提交
git log --oneline main..feat/base-switch-dsh
git log --oneline main..archive/dsh-on-main

# 1) 合并（按你的合并习惯，--no-ff 保留合并点）
git switch main
git merge --no-ff feat/private-assistant -m "merge: private-assistant（DSH 拼接架构 + 自优化闭环）"
git tag v1.4.0-assistant

# 2) 删被取代的分支（tag 仍在，历史可找回）
git branch -d feat/base-switch-dsh      # 若提示未合并，用 -D（tag 已钉）
git branch -D archive/dsh-on-main       # 同上；tag 建议补一个：
git tag archive/dsh-on-main archive/dsh-on-main

# 3) 远端同步
git push origin main --tags
git push origin --delete feat/base-switch-dsh archive/dsh-on-main
```

> 注意：`--force` 一律不用；删分支前先 `git log main..<branch>` 确认无独有提交。

## 3. 合并前还要确认的事

1. `docs/design/DSH-ROLLBACK.md` 里的回退路径仍然成立（回退到 `f15d06bd7`）；
2. `.gitignore` 里 `runtime/`、`assistant/.run/` 仍是忽略的（不把 523MB 运行时或运行数据带进 main）；
3. `portable/agent/settings.json` 这类"外来改动"不要混进合并提交；
4. 合并后跑一遍 `bash scripts/check-conventions.sh` 与 `assistant/scripts/verify-m1.sh`。

## 4. 一句话

**分支数量不是问题，事实源数量才是**：留 `main` + 一个 tag 就够；
`archive/*` 与 `feat/base-switch-dsh` 都是"过程证据"，钉成 tag 后可以安心删分支。
