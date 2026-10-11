# 构建与便携性：卷能力、Node 版本下限、原生模块

本文件记录 **2026-10-12 在 U 盘（exFAT）卷上从零重建 my-pi** 时实测到的三类失败。
它们都不是"注意一下"级别的提醒，而是**硬失败**，且原始报错离根因很远——因此每一节都给出
根因、可重跑证据，以及现在由谁挡住。

适用范围：`bash scripts/build.sh` 的引导链路（根依赖 → `vendor/pi` 引导 → 上游构建）。

---

## 0. 速查表

| 症状（你会看到的） | 真实根因 | 处置 |
|---|---|---|
| `npm error Cannot read properties of null (reading 'edgesOut')` | 目标卷不支持符号链接（exFAT/FAT32），npm workspaces 无法链接工作区包 | 见 §2：换 NTFS 构建后复制产物回来 |
| 构建中途 `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"` | Node 版本低于 22.19（`.ts` 直接执行需要内置类型剥离） | 见 §1：升级到 Node >= 22.19.0 |
| `npm error` + `canvas` + `cairo.h: No such file or directory` | `canvas` 是 devDependency，无预编译包时退化为 node-gyp 源码编译，需要 GTK/cairo | 见 §3：`NPM_CONFIG_IGNORE_SCRIPTS=1` |
| `prebuild-install warn install unable to get local issuer certificate` | Node 自带 CA 链无法校验到下载源（中间人/自签代理）；`curl`/`git` 走 schannel 不受影响 | 见 §3 与 §4 |

> 关键结论：**能在 exFAT 上运行，但不能在 exFAT 上安装依赖。**
> 运行只需要读取文件树；安装需要符号链接。

---

## 1. Node 版本下限：必须 >= 22.19.0（只看主版本不够）

### 根因

my-pi 与全部 13 个 `vendor/pi` 包的 `engines` 都是 `>=22.19.0`，上游 README 亦明言
*"Pi requires Node.js 22.19 or newer"*。真正卡住构建的是**上游脚本直接用 Node 内置类型剥离
运行 TypeScript**：

```
packages/ai/package.json
  "check:model-data":  "node scripts/check-model-data.ts"
  "generate-models":   "node scripts/generate-models.ts --strict"
```

该能力在 Node 22.18+ 才**默认开启**。于是 Node 22.14.0（主版本同为 22）会通过旧的主版本比较，
然后在构建进行到 `packages/ai` 时才崩：

```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"
    for .../vendor/pi/packages/ai/scripts/check-model-data.ts
```

### 可重跑证据

```bash
# 旧判定（只看主版本）会放行 22.14.0：
node -e 'console.log(process.version)'

# 直接暴露根因：用低版本 Node 跑一个 .ts
node vendor/pi/packages/ai/scripts/check-model-data.ts

# 新判定（本仓库已硬化）应拒绝低版本：
bash scripts/build.sh ; echo "exit=$?"          # 版本不足时应在第 1 步就退出
bash scripts/doctor.sh | sed -n '/\[1\]/,/^\[2\]/p'
```

### 已做的修复

`scripts/lib-vendor.sh` 新增单一事实来源，`build.sh` 与 `doctor.sh` 共用（避免两处口径不一致）：

- `PI_NODE_MIN_MAJOR/MINOR/PATCH`（当前 `22.19.0`）与 `PI_NODE_MIN`
- `node_version_ok`：**逐段比较 major/minor/patch**，并容忍预发布后缀
- `node_version_hint`：打印统一升级指引，并点明"仅主版本为 22 并不够"

`build.sh` 第 1 步与 `doctor.sh` 的 `[1] 运行时` 都已改为调用它。

### 本机实测

| Node | 结果 |
|---|---|
| v22.14.0（系统自带） | ✗ 构建在 `packages/ai` 处失败 |
| v22.23.3（便携版） | ✓ `bash scripts/build.sh` 退出码 0，13 个包全部产出 `dist/` |

---

## 2. 卷能力：exFAT 能运行，不能安装依赖

### 根因

npm workspaces 会把工作区包**符号链接**进 `node_modules`：

- 根 `package.json` 声明 `"workspaces": ["custom"]` ⇒ `node_modules/my-pi-custom` → `custom`
- `vendor/pi/package.json` 声明 `"workspaces": ["packages/*", ...]` ⇒ 14 个包的符号链接

exFAT / FAT32 **不支持符号链接**，Windows 上 **junction 也不支持**。在 Windows 上，
即使开启了开发者模式（非管理员可建符号链接），exFAT 依然直接拒绝：

```
$ cmd /c 'mklink /D H:\t\link H:\t\target'
The device does not support symbolic links.
$ cmd /c 'mklink /J H:\t\junc H:\t\target'
Local NTFS volumes are required to complete the operation.
```

于是 npm 报出的并不是"不支持符号链接"，而是一个难以定位的内部错误：

```
npm error Cannot read properties of null (reading 'edgesOut')
    at #loadPeerSet (.../@npmcli/arborist/lib/arborist/build-ideal-tree.js:1289:38)
```

**这条与 my-pi 自身理念直接冲突**：`portable/` 下本就禁止符号链接
（`check-isolation.sh` 检查 1；`setup-external.sh` 为此用 exec shim 替代 `ln -s`）。
把依赖树放到一个不支持符号链接的卷上，等于让"便携"在最关键的一步失效。

### 实测判定（同一个 package.json，只换卷）

| 卷 | 结果 |
|---|---|
| NTFS（D:） | ✓ 安装成功 |
| exFAT（H:），即使放在仓库外的独立空目录 | ✗ `edgesOut` 崩溃 |

结论：**与仓库结构无关，只取决于卷能力。**

### 从零引导实测（2026-10-12，全新 clone）

用 `git clone` 得到全新 checkout（无 `vendor/`、无 `node_modules`）后跑 `bash scripts/build.sh`，
在 NTFS 上**完整跑通（退出码 0，87 秒）**，链路全部经过：

| 阶段 | 实测 |
|---|---|
| Node 版本门禁 | ✓ 通过（22.23.3） |
| 工作区依赖 | ✓ `npm ci` |
| vendor/pi 引导 | ✓ clone → 锁定 `28dcce2` → **11 个补丁全部落为本地 commit**（`local: 001-branding` … `011-tool-search-cjk`） |
| `vendor/pi` 登记 `safe.directory` | ✓ 自动登记（幂等；路径经规范化，避免每次重复写入） |
| 模型数据 | ✓ **联网生成**（`→ 生成模型数据（需要网络）`，产出 42 个 json） |
| 上游构建 | ✓ 13 个包按序产出 `dist/` |
| 产物与冒烟 | ✓ `cli.js` 存在，`--version` → `1.0.4`，`./my-pi.sh` 可启动 |

**一个必须知道的引导前提**：`packages/ai/src/providers/data/` 在上游是 **gitignored**
（`.gitignore:11`），因此**全新 clone 里没有模型数据**，`generate-models` 是**必需步骤**。
此时若设了 `PI_SKIP_MODEL_GEN=1`，`check:model-data` 不会跳过、而是构建失败
（`packages/ai` 的 `build:offline` 以退出码 2 失败）——**"跳过"只在数据已存在时才成立**。
即：**从零引导需要能访问模型数据源的网络**，不只是 GitHub。


### 正确做法：在 NTFS 上构建，把产物复制回来

运行只读文件树，不需要符号链接（实测复制后全树符号链接数 = 0，CLI 正常）：

```bash
# 1) 在 NTFS 卷上构建（D:/E:/C:）
cd /d/_build && bash scripts/build.sh

# 2) 把 vendor/ 与 node_modules/ 复制到 U 盘仓库（保留 .git）
robocopy D:\_build\vendor       H:\my-pi\vendor       /E
robocopy D:\_build\node_modules H:\my-pi\node_modules /E

# 3) 在 U 盘上验证
cd /h/my-pi && node vendor/pi/packages/coding-agent/dist/cli.js --version
```

### 已做的修复

`scripts/lib-vendor.sh` 新增 `preflight_symlinks <dir>`：在**安装前**于目标卷上真实创建并
解析一个符号链接；失败则明确说明原因、症状与两条出路（换 NTFS 构建后复制 / 格式化为 NTFS），
而不是让用户去猜 `edgesOut` 是什么意思。

`build.sh` 在 Node 检查之后新增第 1b 步调用它；**根依赖与 vendor 构建都被跳过时免检**
（那种情况下不需要安装）。

### 可重跑证据

```bash
# 直接判定当前卷能否承载 npm 安装
bash -c '. scripts/lib-vendor.sh; preflight_symlinks "$PWD"; echo "exit=$?"'

# 完整链路：在 exFAT 上应当在安装前就被挡住
cd /h/my-pi && bash scripts/build.sh
```

---

## 3. 原生模块：canvas 是 devDependency，可以安全跳过安装脚本

### 根因

`vendor/pi/packages/ai` 把 `canvas@3.2.3` 列为 **devDependency**（该包测试用）。
本机没有可用的预编译包，npm 退化为 `node-gyp` 源码编译，而 canvas 需要 GTK/cairo：

```
npm error path .../vendor/pi/node_modules/canvas
npm error command failed
npm error command C:\WINDOWS\system32\cmd.exe /d /s /c prebuild-install -r napi || node-gyp rebuild
npm error   cairo.h: No such file or directory
```

上游 README 其实已经写明这条前提：*"Pi does not require dependency lifecycle scripts for a
normal npm installation."*

`canvas` 在 pi-ai 的**源码与测试里都没有被 import**（`grep` 无命中），且构建产物不依赖它。

### 处置

用标准 npm 开关跳过安装期脚本即可（不必改仓库、不必装 GTK）：

```bash
NPM_CONFIG_IGNORE_SCRIPTS=1 bash scripts/build.sh
```

`build.sh` 头部注释已补上这条旁路用法与原因。

> 注意：`prebuild-install` 无法下载预编译包时还会伴随
> `unable to get local issuer certificate`——那是 Node 自带 CA 链无法校验下载源
> （本机 `curl`/`git` 走 Windows schannel 正常，只有 Node 受影响），与 canvas 本身无关。

---

## 4. 与前两类无关但会一起出现的干扰项（避免误判）

排查时容易把这些当成 my-pi 的 bug，实际是环境差异：

| 现象 | 真相 |
|---|---|
| `git` 报 `fatal: detected dubious ownership` | exFAT 不记录文件属主。每台新机器需 `git config --global --add safe.directory <repo>`；**git 有意忽略仓库自身的 `safe.directory`**（否则恶意仓库可自我放行），所以无法随盘携带。**注意 `vendor/pi` 是独立 git 仓库，要单独登记一次**（`build.sh` 已在 clone 后自动登记） |
| `check-isolation.sh` 报 `vendor/pi/ 有未提交的修改`，但人工看它是干净的 | **归因错误的假警报**，见 §4.1。真因是上面的属主问题，与"有改动"无关 |
| `build.sh` 里 clone 的是 `earendil-works/pi-mono.git` | 该 URL 已 301 重定向到 `earendil-works/pi`，git 自动跟随；`PINNED_COMMIT` 指向的 commit 确实存在，**无需修改** |
| npm 报 `EBADENGINE` 警告 | `engines` 声明与实际 Node 不一致时 npm 只警告（默认 `engine-strict=false`），不构成失败；真正卡住构建的是 §1 的类型剥离 |
| bash 脚本在 Windows 上行为异常 | 用 **git-bash**（`/h/my-pi` 形式路径）而非 WSL 的 `bash`；WSL 看到的是另一套文件系统视图 |

### 4.1 诊断教训：「读不了」与「有改动」必须分开

`check-isolation.sh` 曾报 `vendor/pi/ 有未提交的修改`，而 `vendor/pi` 其实是干净的
（`status --porcelain` 输出 0 行）。这条假警报**指向了错误的方向**——按字面去查改动会白费时间。

根因是三态混淆：

| `git diff --quiet` 退出码 | 含义 |
|---|---|
| 0 | 干净 |
| 1 | 有改动 |
| **129** | **读不了仓库**（exFAT 属主检查 → 退化为 `--no-index` 用法错误） |

`if ! git diff --quiet` 只看"非 0"，把 129 归进了"有改动"；原实现还配了 `2>/dev/null`，
连线索都吞掉了。

已固化到 `scripts/lib-vendor.sh` 的三个共享判据，由 `check-isolation.sh`、`doctor.sh`、
`sync-upstream.sh`、`build.sh` 共用（单一事实来源，避免各脚本口径漂移）：

| 判据 | 语义 |
|---|---|
| `git_repo_readable <repo>` | 0 = git 能读该仓库 |
| `git_dirty_state <repo>` | 0 = 干净 ／ 1 = 有改动 ／ 3 = 读不了 |
| `git_unreadable_hint <path>` | 打印修复命令（`safe.directory` 按实际路径推导） |

可重跑证据：

```bash
bash -c '. scripts/lib-vendor.sh; git_dirty_state vendor/pi; echo "vendor/pi -> $?"'
# 期望 0（干净）。若期望为 3，说明 git 读不了它，按 git_unreadable_hint 打印的命令修复。

bash -c '. scripts/lib-vendor.sh; git_unreadable_hint /h/my-pi/vendor/pi'
```


---

## 5. 预防：为什么这三条被写成守门而不是文档提醒

my-pi 的既定纪律是"反复有效的软引导必须硬化"（VISION §3.1），"数据完整性不依赖模型自觉"
（§3.2）。这三类失败都满足硬化条件：**报错点离根因远、可确定性判定、且会重复发生**。

| 编号 | 硬化落点 |
|---|---|
| §1 | `scripts/lib-vendor.sh` 的 `node_version_ok` / `node_version_hint`，被 `build.sh` 与 `doctor.sh` 共用（单一事实来源） |
| §2 | `scripts/lib-vendor.sh` 的 `preflight_symlinks`，`build.sh` 第 1b 步在安装前调用 |
| §3 | `build.sh` 头部注释给出旁路用法；无自动守门（属"可选依赖缺平台构建工具"，刻意不做成失败） |

对应事故台账见 [`BUG-REPLAYS.md`](../BUG-REPLAYS.md) 第 27–29 条。

---

## 相关

- 上游同步流程：[`UPSTREAM-UPDATE.md`](UPSTREAM-UPDATE.md)
- 多环境识别与数据隔离：[`ENVIRONMENTS.md`](ENVIRONMENTS.md)
- 系统化排障入口：[`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md)
- 脚本索引与运行成本：[`../../scripts/README.md`](../../scripts/README.md)
