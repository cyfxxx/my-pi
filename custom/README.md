# Custom Layer

本目录是 my-pi 的自定义层，与上游 Pi 代码完全隔离。

## 目录结构

```
custom/
├── adapters/           # 适配器层（唯一允许 import vendor/pi 的地方）
│   ├── hook-adapter.ts
│   └── tool-adapter.ts
├── core/               # 核心服务
│   ├── config.ts       # 路径解析（portable/agent + portable/memory）
│   └── registry.ts     # 功能注册表
├── features/           # 功能模块（每个功能两个文件）
│   └── web-search/
│       ├── logic.ts    # 纯逻辑，零 Pi 依赖
│       └── index.ts    # 通过 adapter 注册
├── bootstrap.ts        # 唯一入口（默认导出扩展工厂函数）
└── README.md
```

功能清单在 `bootstrap.ts` 的 `FEATURES` 中维护；pi 以 `--extension custom/bootstrap.ts` 加载本层。

## 核心原则

1. **上游隔离**：`vendor/pi/` 永不修改
2. **接口隔离**：`adapters/` 是唯一允许 import `vendor/pi/` 的地方
3. **逻辑隔离**：`features/*/logic.ts` 零 Pi 依赖

## 禁止事项

- 禁止在 `custom/` 下创建 `seams/`、`events/`、`session-log/`、`src/`、`docs/`、`tests/`、`config/` 等目录
- 禁止在 `custom/` 下创建 `integration.ts`、`extension-loader.ts`、`cordis.yml` 等文件
- 禁止在 `features/*/logic.ts` 中 import `vendor/pi/`
- 禁止在 `adapters/` 之外 import `vendor/pi/`（`import type` 除外）

## 验证

运行 `bash scripts/check-isolation.sh` 验证隔离边界。