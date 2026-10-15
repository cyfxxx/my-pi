# dsh/ —— my-pi 在 DSH 上的落点（插件打包 + profile 接线）

底座从 pi 换到 DSH 分两层：

| 层 | 位置 | 作用 |
|---|---|---|
| **适配层**（机制） | [`custom/adapters/dsh/`](../custom/adapters/dsh/README.md) | 把 DSH 的 `Context` 包装成 pi 形状 API（工具/钩子/命令/快捷键），features 一行不改 |
| **交付层**（本目录） | `dsh/plugin/`、`dsh/profile/` | 把适配层 + 全部特性打成**可安装产物**，并给出能被真实 `dsh` launcher 接受的 profile 覆盖层 |

## 目录

```
dsh/
  plugin/
    entry.ts         # 产品入口：把 custom/bootstrap.ts 的全量特性固定进来（机制在 custom/adapters/dsh/plugin.ts）
    package.json     # 产物包元信息 + 依赖声明（typebox/ws/tinyglobby + 可选 playwright/@xterm）
    dist/            # ★ 构建产物（gitignored，由 scripts/dsh-build.sh 生成）
  profile/
    my-pi.patch.yml  # 插进 DSH profile 的覆盖层（`insert:` 语义；相对路径以本文件为锚点）
  spike/
    package.json     # spike 用的 DSH 依赖（gitignored node_modules）
    spike.ts         # 源码级端到端（A1–A9，含真实搜索/拦截语义/全量 bootstrap）
    smoke-built.mjs  # **产物级**冒烟（纯 node，无 tsx）
```

## 怎么跑（三条命令，都不启动 Host）

```bash
bash scripts/dsh-build.sh            # 打包 + 产物冒烟（纯 node 加载 dist，断言 54 工具 / 0 失败）
bash scripts/dsh-spike.sh            # 源码级 spike（A1–A9，真实 @deepseek-ai 包 + pi shim）
bash scripts/dsh-smoke-profile.sh    # 真实 launcher 的 profile 组合干跑（隔离 DSH_HOME，--dump-config）
```

## profile 接线的实测结论（**踩过再写下来**）

| 尝试 | 结果 |
|---|---|
| `- id: my-pi` + `name: …` | ❌ `patch: entry "my-pi" not found` —— `id` 是**覆盖已有条目**的语义 |
| `- insert: [{ id: my-pi, name: … }]` | ✅ 组合树打印 `- id: my-pi / name: file:///…/my-pi-plugin.mjs` |

`--dump-config` 是**只组合、不启动**的干跑，所以能在不打扰正在运行的 `dsh web`、
也不碰凭据/内存的前提下，证明"插件被真实 launcher 接受"。实测（dsh 0.2.0-rc.2）：模板
`headless` 基线条目 96 条，叠加后出现我们的条目 ✓。

## ✗ 尚未做（如实）

1. **Host 级真正启动未验证**：需要有凭据的 `DSH_HOME` + 内存（本机约 1.8–2.5 GB 可用）+
   不能打扰正在运行的 GUI ⇒ 单列为下一步，不在这里硬跑。
2. **形式化发布**：目前 profile 通过**相对路径**引用产物；正式做法应把 `my-pi-dsh-plugin`
   作为 profile 依赖 install（`dsh plugin --profile …` 走 pnpm），并处理它的依赖树。
3. **基线重建（P6）**：注入面基线 / 工具面预算 / 场景测试 / 补丁检查都还是 pi 侧的，
   DSH 侧必须重算（见 [DSH-MIGRATION-PLAN](../docs/design/DSH-MIGRATION-PLAN.md) 第 4 节 D 块）。
4. **行为等价**：目前证到"能加载、能注册、工具能被真实注册表调用、拦截语义生效"；
   逐特性的行为差异（尤其会话生命周期与压缩干预那 7 个 ② 档事件）仍需逐条迁移。

## 相关

- 迁移执行计划与进度：[`docs/design/DSH-MIGRATION-PLAN.md`](../docs/design/DSH-MIGRATION-PLAN.md)
- 可行性评估（含 2026-10-10 spike 原始输出）：[`docs/design/BASE-SWITCH-DSH.md`](../docs/design/BASE-SWITCH-DSH.md)
- 钩子逐类映射（18→19 条）：[`docs/design/DSH-HOOK-MAPPING.md`](../docs/design/DSH-HOOK-MAPPING.md)
