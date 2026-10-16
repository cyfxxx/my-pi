# pi-shims —— 让 DSH 侧**不依赖 pi 包**也能加载全部特性

## 为什么需要它们

`custom/adapters/ui-adapter.ts` 与 `session-adapter.ts` 在**运行时** import 两个 pi 包
（这是本仓"只有 adapters 接触底座"的约定带来的唯一运行期耦合）：

```
grep -rn "^import " custom --include='*.ts' | grep -v 'import type' | grep '@earendil-works'
  custom/adapters/ui-adapter.ts:11      Key, Container, Markdown, Spacer, Text, truncateToWidth, visibleWidth   ← pi-tui
  custom/adapters/ui-adapter.ts:13      getMarkdownTheme                                                       ← pi-coding-agent
  custom/adapters/session-adapter.ts:9  SessionManager                                                         ← pi-coding-agent
```

pi 自己靠 `vendor/pi/node_modules/@earendil-works/*` 解析这些 specifier；**DSH 部署里没有 pi 包**，
所以不提供等价物的话，任何 import `ui-adapter` 的特性会在**加载期**就
`ERR_MODULE_NOT_FOUND`（不是优雅降级）。

## 怎么用（别名机制）

Node 的裸包解析是"从**导入方文件**所在目录向上找 `node_modules`"，所以别名要放在
**对所有导入方都可见**的位置。`scripts/dsh-spike.sh` 的现场做法：

```bash
mkdir -p node_modules/@earendil-works            # 仓库根（gitignored）
ln -sfn "$PWD/custom/adapters/dsh/pi-shims/tui"          node_modules/@earendil-works/pi-tui
ln -sfn "$PWD/custom/adapters/dsh/pi-shims/coding-agent" node_modules/@earendil-works/pi-coding-agent
bash scripts/dsh-spike.sh --no-install           # A9：全量 bootstrap 仍应 54 工具 / 0 失败
```

★ **2026-10-18 起打包产物不再依赖这条别名**：`scripts/dsh-build.sh` 用 esbuild 的
`--alias:@earendil-works/pi-coding-agent=…/pi-shims/coding-agent/index.js`（`pi-tui` 同理）把这两个
specifier **改写成本目录的路径再打进产物** ⇒ 产物**自带** shim，装到真 profile 时也不需要
profile 级 `pnpm.overrides`。

为什么改：包清单是 `files: ["dist", "README.md"]` ⇒ shim **不在分发包里**，而原先的策略要求
"部署侧把 specifier 别名到本目录" —— 那条路从未在真 profile 跑过（一直登记为未核实 ✗）。
实测（把仓库根的别名**搬走**后跑真 Host）：退出码 0、模块解析失败 **0** 条、注册汇总不变
（`工具 53 / 命令 10 / 冲突 1 / 钩子 18`）⇒ 自包含成立。

上面那段 `ln -sfn …` 仍然有用：**本地开发/spike**（`tsx` 直接跑 TS 时不做打包，需要 Node 能解析
这两个 specifier）。

`PI_SPIKE_PI_ALIAS=vendor` 可切成"别名到 vendor/pi 真包"的**对照模式**（行为更完整，但那是 pi 的代码）。

## 契约（哪些是真实现、哪些是降级）

| shim | 导出 | 行为 |
|---|---|---|
| `tui/` | `visibleWidth` / `truncateToWidth` | **真实现**（按东亚宽度计算列数）——纯字符串计算，与底座无关 |
| `tui/` | `Text` / `Spacer` / `Markdown` / `Container` | 惰性对象：可构造、可 `addChild`/`clear`/`render()`，**不产生可视输出**（首次使用上报一次） |
| `tui/` | `Key` | 显式键表（`ctrlAlt` 等）；**未知键返回占位并上报**，不给 `undefined` |
| `coding-agent/` | `getMarkdownTheme` | 返回最小占位主题（渲染路径不崩，结果无意义） |
| `coding-agent/` | `SessionManager.list/listAll` | **返回 `[]` + 上报**（DSH 会话是存储模型，接它的服务是后续工作） |

**纪律**：shim 只导出"有依据"的符号 —— 依据就是上面那条 grep 名单。
**漂移守门**：`custom/adapters/dsh/__tests__/pi-shims.test.ts` 会读这两个适配器文件、
抠出运行期 import 名单，逐名断言 shim 已导出。新加一个 pi 运行期符号却忘了补 shim ⇒ **测试红**
（tsc 用的是 vendor/pi 的类型映射，查不出这类缺口）。

## ✗ 缺口（如实）

1. 惰性组件不渲染；依赖 TUI 渲染**算出值**再用于逻辑的功能，在 DSH 上这部分行为缺失（已上报）。
   正确的 DSH 形态是改用 `output.render` / `presentationMeta`（见 [`../README.md`](../README.md)）。
2. 会话枚举/切换未实现 ⇒ 依赖它的功能（link 的会话选择等）在 DSH 上不完整。
3. shim 目前是"让特性**能加载**"的最小实现；逐功能的**行为等价**属于 P6（基线重建）范围。
