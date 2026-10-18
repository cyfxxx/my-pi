# DSH 合并已回退：`main` 回到合并前，经验留在 `main`

> 结论：`main` 指回 **`eda6d1405`**（合并前的最后一个提交）。DSH 那一整套没有丢，
> 它在三个地方完整保留；而被这次迁移**证出来**的通用经验已回灌到 `main`。

## 1. 回退到哪、为什么

- **回退点**：`eda6d1405`（`feat/base-switch-dsh` 分叉前的 `main`）。
  当时的合并是**快进**（无 merge commit），所以"回退"就是把 `main` 指回这个提交，
  与 `DECISIONS.md` 里 2026-10-17 那条记录写的回滚方式一致。
- **为什么**：DSH 那条线把 `main` 变成了"pi + 实验性第二底座"，但它的收益与维护成本
  需要在主线之外继续评估。回退让 `main` 重新是**单一底座（pi）**的干净状态。

## 2. DSH 的东西在哪（一件没丢）

| 位置 | 内容 |
|---|---|
| 分支 `feat/base-switch-dsh`（本地 + 远端） | 69 笔迁移提交，止于标签点 `dcdc3dfe2` |
| 标签 `v1.3.0-dsh` | 同一个提交，稳定引用（分支以后若动，标签不动） |
| 分支 `archive/dsh-on-main`（本地 + 远端） | 合并**之后**在 `main` 上的 9 笔收口提交（GC / doctor / 范围感知守门 / DR-4 收件箱 / 具名 agent / 陷阱 #22 等） |

恢复任意状态：

```bash
git checkout v1.3.0-dsh          # 合并点的完整 DSH 迁移
git checkout archive/dsh-on-main # 合并 + 之后的收口
```

## 3. 回灌到 `main` 的经验（这才是"不要丢失"的部分）

| 回灌项 | 为什么它跟 DSH 无关 |
|---|---|
| `docs/design/CODING-TRAPS.md`（#1–#22） | 陷阱大多来自通用工程面：`pkill` 自匹配、症状表不是病因、`apply` 异步导致注册消失、注册成功≠工具面可见、只跑一个 tsconfig、改入口不重建产物…… |
| `docs/BUG-REPLAYS.md`（#39–#46）+ `docs/knowledge/patterns/**` | 每条都有可执行复现；知识库的失败模式/被否提案由它编译而来 |
| `DECISIONS.md`（全量，含 16 条被否提案） | 决策日志是历史，不因回退而删；被否提案恰恰是"以后别再试一遍"的资产 |
| `custom/features/mode/session-key.ts` + 测试 | 修的是**真实回归**：把依赖 `this` 的方法解绑调用 ⇒ 静默 `undefined`，打穿模式重启链（留出集抓到） |
| `custom/core/config.ts` 的 `MY_PI_ROOT`/`PI_ROOT` | 打包后 `import.meta.url` 指向产物位置，根目录会被解析错；环境变量覆盖是通用修法 |
| `custom/adapters/session-adapter.ts` 的可注入 lister | pi 路径零改动（默认走 `SessionManager`），只是把"底座实现"变成可注入点 |
| `web-search` → `searxng` 改名 | 与 DSH 重名冲突无关的那部分结论：私有实例就是 searxng，沿用统一命名 |
| `scripts/check-md-tables.mjs` + 约定守门 L 段 | 通用守门：程序化编辑会把 Markdown 表格写断，而当时所有守门都放行 |

## 4. 没回灌的部分（DSH 专属，留在分支）

`dsh/`（插件与 profile）、`custom/adapters/dsh/**`、`scripts/dsh-*.sh|mjs`（宿主安装/启动/体检/回收/收件箱/golden 第 22 步）、
`my-pi.sh` 的双底座分派（`web|headless|acp`）、`docs/design/DSH-*.md`、`docs/operations/DSH-UPGRADE.md`、
`portable/dsh/**` 的运行数据。

理由：这些没有 DSH 宿主就无法运行，放在 `main` 上只会变成"文档描述一个不存在的底座"。

## 5. 回退后 `main` 的形状

- 仍是**单一底座 pi**：`./my-pi.sh` 走 pi TUI；`scripts/` 71 个（回灌了 `check-md-tables.mjs`）；
- 三处 pi 侧共享改动保留（见上表），所以行为上比回退点多两个修复、一个改名；
- `docs/INDEX.md`、`docs/CHANGES.jsonl`、`docs/knowledge/` 全部按回退后的树重新生成。

## 6. 其它分支的关系

- `feat/private-assistant`（拼接式助手实验）基于**合并后的** `4453d3965`，回退后它不再是 `main` 的后代；
  它自带完整实现（`assistant/`），与本次回退互不影响。
- 若以后要让 DSH 回到主线，推荐做法仍是 `git merge --ff-only feat/base-switch-dsh`（先评估
  `archive/dsh-on-main` 里那 9 笔收口是否也要一起进来）。
