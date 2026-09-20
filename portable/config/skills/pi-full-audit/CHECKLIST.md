# 人工检查清单

## 代码审查清单

不要只看 diff 表面，对每个变更文件逐项核对：

### 1. 正确性

- 分支是否覆盖边界值、空值、null/undefined、空数组/空字符串
- 错误处理路径：异常是否被捕获并给出有用信息，失败时是否回滚
- 类型转换陷阱：字符串/数字隐式转换、NaN、精度（浮点/大数）
- 循环边界：off-by-one、无限循环、死循环风险

### 2. 安全

- 输入校验：用户输入是否经过校验/清洗（命令注入、路径穿越、模板注入）
- 权限/授权：新增工具或命令是否越权访问文件或网络
- 硬编码密钥、密钥落盘、日志中泄露敏感信息
- 路径穿越：拼接用户输入的文件路径是否被消毒
- 密钥读写统一走 `custom/core/secrets.ts`，不自行实现脱敏

### 3. 资源

- 文件句柄/网络连接/子进程是否关闭（try/finally）
- 超时设置：外部调用（浏览器、网络搜索、语音）是否有超时，超时后行为是否正确
- 大循环/递归深度：是否存在内存或 CPU 风险
- 工具输出是否过大：超量输出应经 `custom/features/context/output-archive.ts` 归档为占位符

### 4. 并发与状态

- 共享可变状态：竞态条件、重复执行副作用
- 异步：回调/promise/await 是否遗漏或错误串联
- 会话/回合钩子重复触发时是否幂等

### 5. 回归影响

- 被修改 API/函数的所有调用方是否受影响（用 grep 搜调用处）
- 配置、环境变量、依赖版本变更的影响面
- 涉及 `portable/config/settings.json` 键名变更时，读取方是否同步

### 6. 可维护性

- 死代码、重复逻辑、未使用变量/导入
- 命名是否反映意图；注释是否与实现一致（过时注释）
- `console.log` 是否只是模块注册日志（属正常），避免遗留调试输出

### 7. 架构边界（my-pi 专项）

- `custom/features/*/logic.ts` 零 Pi 依赖（不得 import `vendor/pi`）
- Pi API 只出现在 `custom/adapters/`；`custom/core/config.ts` 的路径解析除外
- 运行时数据只落 `portable/`，不写仓库根或其它位置
- `vendor/pi/` 无直接改动；改动只体现为 `patches/*.patch`
- 新增功能是否在 `custom/bootstrap.ts` 注册

---

## 仓库优化清单

### 1. 目录结构

- 每个顶层目录是否有明确职责（`vendor/` 上游只读 / `custom/` 自维护代码 / `portable/` 运行时数据 / `packs/` 外部技能包 / `scripts/` 运维脚本 / `patches/` 补丁 / `docs/` 文档）
- 是否存在无归属的孤儿目录
- 嵌套深度是否合理（超过 4 层需评估）

### 2. git 管理

- `.gitignore` 是否覆盖所有运行时数据（`portable/sessions/`、`portable/memory/`、`portable/extensions/`、`portable/config/` 下的本地状态）
- `vendor/pi/` 是否被忽略（独立 git clone）
- 是否有不该入库的文件被跟踪（lock 文件、构建产物 `custom/dist/`、临时文件、大二进制）
- ignore 规则是否重复或冲突
- remote URL 是否含 token（推送前必须检查）

### 3. 存储卫生

- 大文件扫描：`*.bak.*`、`.artifacts/`、测试生成的二进制、迁移遗留
- `__pycache__`、`.DS_Store`、`Thumbs.db` 等系统文件是否已忽略
- 历史大文件是否需要 `git filter-repo` 清理（先确认 `vendor/pi/` 与并行克隆不受影响）
- `packs/` 各包体积是否有异常大的附带资源

### 4. 两类文件边界

| 入库共享 | 运行时本地 |
|----------|-----------|
| `custom/` 源码 | `portable/sessions/` 会话 |
| `scripts/`、`patches/`、`docs/` | `portable/memory/` 笔记与工具输出归档 |
| `portable/config/` 白名单配置（settings/keybindings/AGENTS/APPEND_SYSTEM） | `portable/config/` 的 auth/models/trust/pi-link-* 等状态 |
| `packs/` 技能包 | `portable/extensions/` 扩展安装 |

### 5. 文档同步

- `README.md`/`STRUCTURE.md` 的目录清单与实际一致
- `AGENTS.md` 的功能模块清单与 `custom/features/` 一致
- `patches/README.md` 的补丁表与 `patches/` 实际文件一致
- `CHANGELOG.md` 的版本号与 `package.json` 一致
