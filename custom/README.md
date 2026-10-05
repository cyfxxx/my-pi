# Custom Layer

本目录是 my-pi 的自定义层，与上游 Pi 代码完全隔离。

## 目录结构

```
custom/
├── adapters/           # 适配器层（唯一允许 runtime import vendor/pi 的地方）
│   ├── hook-adapter.ts     # 生命周期钩子
│   ├── tool-adapter.ts     # 工具注册
│   ├── ui-adapter.ts       # 命令/快捷键/渲染器
│   └── session-adapter.ts  # 会话枚举
├── core/               # 核心服务（纯逻辑，零 Pi 依赖；10 个文件）
│   ├── config.ts           # 路径解析
│   ├── registry.ts         # 功能注册表
│   ├── atomic-write.ts     # 原子写
│   ├── fs-json.ts          # JSON/JSONL 读写基元
│   ├── file-lock.ts        # 跨进程文件锁（RMW 串行化）
│   ├── text.ts             # 文本/数值格式化
│   ├── cli.ts              # 命令参数/补全解析
│   ├── secrets.ts          # 脱敏
│   ├── net-guard.ts        # SSRF 防护
│   └── index.ts            # 统一导出
├── features/           # 12 个功能模块（详见 features/README.md）
│   ├── web-search/         # 小功能：直接铺 logic.ts + index.ts
│   └── memory/             # 大功能：按职责分组子包，logic.ts 仅作 barrel
│       ├── logic.ts        # 纯逻辑 barrel（对外统一出口）
│       ├── index.ts        # 通过 adapter 注册
│       ├── store/          # 存储/合并/摘要
│       ├── recall/         # 检索/注入
│       └── mine/           # 治理/教训挖掘
├── web-terminal/       # 浏览器接入通道（独立进程，非 pi 扩展；pty + HTTP/WS + xterm.js）
├── bootstrap.ts        # 唯一入口（默认导出扩展工厂函数）
└── README.md
```

约定：`index.ts`（注册）与 `logic.ts`（纯逻辑出口）始终位于功能根目录；当功能模块较多时，
在功能目录下按职责建一层子包（如 `store/`、`recall/`、`ui/`），子包内文件互相引用用相对路径，
跨功能引用只走对方的 `logic.ts` barrel。

功能清单在 `bootstrap.ts` 的 `FEATURES` 中维护；pi 以 `--extension custom/bootstrap.ts` 加载本层。

## 分层说明

- [core/README.md](core/README.md) — 核心服务层（纯逻辑底座）
- [adapters/README.md](adapters/README.md) — 适配器层（唯一接触 Pi API）
- [features/README.md](features/README.md) — 功能层（12 个扩展与规范）
- [web-terminal/README.md](web-terminal/README.md) — 浏览器接入通道（独立进程：在 pty 里拉起原样 TUI，由 xterm.js 接管）

## 分层之外的接入通道

`web-terminal/` **不是 pi 扩展**，而是与 `my-pi.sh` 并列的独立进程入口：它起一个只监听回环的
HTTP/WS 服务，在 pty 里拉起 `my-pi.sh`，浏览器用 xterm.js 接管该终端。因此它不注册工具/钩子，
不进 `bootstrap.ts` 的 `FEATURES`，也不受"三层结构"约束（但同样零 Pi 依赖）。

## 核心原则

1. **上游隔离**：`vendor/pi/` 永不修改
2. **接口隔离**：`adapters/` 是唯一允许 import `vendor/pi/` 的地方
3. **逻辑隔离**：`features/` 下的逻辑层（`index.ts` 与 `__tests__/` 除外）零 Pi 依赖

## 禁止事项

- 禁止在 `custom/` 下创建 `seams/`、`events/`、`session-log/`、`src/`、`docs/`、`tests/`、`config/` 等目录
- 禁止在 `custom/` 下创建 `integration.ts`、`extension-loader.ts`、`cordis.yml` 等文件
- 禁止在 `features/` 的逻辑层中 import `vendor/pi/`
- 禁止在 `adapters/` 之外 import `vendor/pi/`（`import type` 除外）

## 验证

运行 `bash scripts/check-isolation.sh` 验证隔离边界。