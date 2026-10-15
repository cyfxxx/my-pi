# Linux 完全便携化：运行时装进仓库、随项目移动

**一句话**：my-pi 在 Linux 上不再"依赖本机装了什么"——Node、CPython、SearXNG（含它的
Python 依赖）、pip/npm 缓存、服务私有 `HOME`/`XDG`/`TMP` 全部落在 `<repo>/runtime/<平台>/`，
`runtime/` 整目录 gitignored，**把仓库拷到别的路径/别的机器照样能跑**（有可复跑的搬移测试）。

配套文档：[`BUILD-PORTABILITY.md`](BUILD-PORTABILITY.md)（卷能力 / Node 版本下限 / 原生模块，
Windows 与 Linux 共用）、[`VOLUME-REBUILD.md`](VOLUME-REBUILD.md)、[`ENVIRONMENTS.md`](ENVIRONMENTS.md)。

---

## 0. "完全便携"的三条判据（先定标准，再谈实现）

| 判据 | 含义 | 谁在守 |
|---|---|---|
| **R-零仓外默认** | 生产代码里不能有"默认指向仓库外"的绝对路径（`/opt/...`、`~/.local/...`、`C:\Users\...`） | `scripts/check-portability.sh` 的 P1（注释里的历史路径不算） |
| **R-随路径移动** | 换一个绝对路径后，Node / Python / 站点包 / 服务全部可用，且**不依赖系统 node/python** | `scripts/test-portability-move.sh`（七步端到端，见 §5） |
| **R-证据可复跑** | 每条结论都能用一条命令重跑，不靠"我检查过了" | 上述两个脚本 + `bash scripts/portable-runtime.sh verify` |

> 为什么把这三条写死：便携性的失效**不报错**。它只在"换台机器/换个挂载点/整盘拷走"时集中
> 爆出来，而那时离改动已经很远（2026-10-15 实测前，Linux 侧 Node 来自
> `~/.local/share/pi-node`、SearXNG 在 `/opt/searxng`、whisper/sherpa venv 在 `/opt/*`、
> npm 缓存写 `~/.npm` —— 全是仓外，但本机跑起来毫无异常）。

---

## 1. 布局与解析顺序

```
<repo>/runtime/                       # ★ 整目录 gitignored；随项目（随盘）移动
  downloads/                          #   已校验的归档缓存（node/python/searxng 源码）
  <os>-<arch>/                        #   当前平台：linux-arm64 / linux-x64 / win-x64 / darwin-*
    node/bin/node                     #   便携 Node（官方 tarball，sha256 校验后解包）
    py/bin/python3                    #   便携 CPython（python-build-standalone）
    ext/py/site-packages/             #   通用三方包（pip --target；纯数据、天然可搬迁）
    ext/searxng/{src,site,settings.yml,home,log,run,tmp}
    ext/whisper/{venv,models}         #   重依赖服务（venv 启动时自愈，见 §3.2）
    ext/sherpa/{venv,models}
    ext/tts/models                    #   piper 等 TTS 模型
    bin/                              #   可选：随项目携带的 CLI（fd 等）
    npm-cache/ pip-cache/ pycache/ tmp/
  node/                               #   旧扁平布局（Windows 现状）→ 兼容保留，不写入
```

**平台标识**：`<os>-<arch>`，与 `scripts/lib-portable.sh` 的 `pi_platform()` 同口径；
TS 侧由 `custom/core/config.ts` 的 `portablePlatform()`/`getExtDir()` 给出**同一口径**
（否则 shell 装了、TS 找不到，症状是 piper 静默回退 espeak）。

**Node 解析优先级**（`pi_resolve_node`，`scripts/lib-portable.sh`）：

1. `MY_PI_NODE`（显式指定，必须版本达标）
2. `<repo>/runtime/<平台>/node/bin/node`
3. `<repo>/runtime/<平台>/node/node[.exe]`（扁平布局，Windows tarball 形态）
4. `<repo>/runtime/node/node[.exe]`（**旧扁平布局**，Windows 现状兼容）
5. `<repo>/../runtime/node/...`（历史"工具分区"布局）
6. `PATH` 上的 `node`

**Python 解析优先级**：`PI_PY` → `<repo>/runtime/<平台>/py/bin/python3` → `PATH` 上的
`python3`/`python`（**末位兜底**，此时 `portable-runtime.sh verify` 会判失败，因为"便携性未达成"）。

> 解析点只有**一处**：此前 `run-my-pi.ps1` / `pi-supervisor.sh` / `lib-vendor.sh` 各写一份，
> 漂移过一次（`mode_resolve` 拿到 node、裸 `node` 却调不到 ⇒ 启动行模式为空，
> 见 [`BUILD-PORTABILITY.md` §4.3](BUILD-PORTABILITY.md)）。2026-10-15 起统一到
> `scripts/lib-portable.sh`，其他位置只调用它。

---

## 2. 两条硬纪律（后面的实现都靠它成立）

1. **一律 `python -m <模块>`，不调用 venv 的 `bin/` 脚本**
   console script 的 `#!` 里是**绝对路径**，仓库一搬就失效（`pip`、`uvicorn`、`granian`
   都是如此）。`python -m pip` / `python -m granian` / `python -m uvicorn` 没有这个问题。
   ⇒ 启动 SearXNG 用的是 `"$py" -m granian --interface wsgi searx.webapp:app`。
2. **通用包不建 venv，改 `pip install --target` + `PYTHONPATH`**
   venv 的 `pyvenv.cfg` 与 `bin/python*` 都带绝对路径；`--target` 装出来的站点目录是**纯数据**，
   整盘搬走仍然可用。`pi_portable_env` 会把 `<repo>/…/ext/py/site-packages` 追加进 `PYTHONPATH`。
   （例外：faster-whisper / sherpa-onnx 这类重原生依赖仍按 venv 组织，靠 §3.2 的**自愈**保证可搬。）

---

## 3. 怎么装

```bash
bash scripts/portable-runtime.sh status            # 现在处于什么状态（只读、随时可跑）
bash scripts/portable-runtime.sh node              # 便携 Node   → runtime/<平台>/node
bash scripts/portable-runtime.sh python            # 便携 CPython→ runtime/<平台>/py
bash scripts/portable-runtime.sh deps              # pack 依赖（默认 pdf media game）→ ext/py/site-packages
bash scripts/portable-runtime.sh searxng           # SearXNG 源码+依赖+settings → ext/searxng
bash scripts/portable-runtime.sh verify            # 自证：版本/落点/导入/缓存/忽略规则
bash scripts/portable-runtime.sh all               # node + python + 默认依赖 + verify
```

清单在 [`scripts/portable-artifacts.txt`](../../scripts/portable-artifacts.txt)：
版本、镜像、以及**每个制品的 sha256**（取自官方 `SHASUMS256.txt` 与 GitHub Release 的
`digest` 字段）。纪律：**sha256 只许用 `sha256sum` 生成后粘入，不许手抄**——本次实测手抄
一次就把 `…2d7b…` 写成 `…2b7b…`，被下载校验当场拦下（见 §6 的"证据"）。

镜像与兜底：

| 制品 | 主通道 | 兜底 | 本机实测 |
|---|---|---|---|
| Node | 阿里云 `mirrors.aliyun.com/nodejs-release` | `nodejs.org/dist` | 28.83 MB / 12 秒（≈2.3 MB/s），sha256 ✓ |
| CPython | GitHub Release 直连 | `gh-proxy.com` / `ghproxy.net` 前缀 | 28 MB；直连时通时断，代理 ≈300 KB/s |
| SearXNG | `codeload.github.com`（**commit 内容地址**） | 同上代理前缀 | 6.5 MB / 6 秒；两次独立下载逐字节相同 ✓ |

> 代理只影响"快不快"，不影响"对不对"：无论走谁，落地前都要过清单里的 sha256，
> 不一致就**丢弃并换下一个通道**（本次 gh-proxy 转发的字节与直连完全相同，可自证）。

### 3.1 通用依赖（pdf / media / game / voice / sherpa）

| profile | 来源（单一事实来源） | 备注 |
|---|---|---|
| `pdf` | `packs/pdf-toolkit/requirements.txt` | pypdf / pdfplumber / pymupdf / reportlab |
| `media` | `packs/media-toolkit/requirements.txt` | pillow |
| `game` | `packs/gamedev/skills/design/create-game-assets/scripts/requirements.txt` | pillow |
| `voice` | 清单内联：`faster-whisper opencc-python-reimplemented` | 重，按需 |
| `sherpa` | 清单内联：`sherpa-onnx numpy` | 重，按需 |

`deps` 默认**拒绝**用系统 python（会提示先装便携解释器）；确实受限时用
`bash scripts/portable-runtime.sh deps --system pdf` 显式降级（届时 `verify` 会如实报"解释器在仓外"）。

### 3.2 重依赖服务（whisper / sherpa）的 venv 自愈

`custom/features/voice/scripts/pi-{whisper,sherpa}.sh` 的默认 venv/models 已改到
`<repo>/runtime/<平台>/ext/{whisper,sherpa}/`，并在启动前调用 `pi_py_repair_venv`：

- 重写 `pyvenv.cfg` 的 `home =`（基础解释器目录）
- 把 `bin/python*` 的**绝对**符号链接改成**相对**链接

⇒ 整盘搬走后 venv 仍然能起来（`#!` 类的 console script 不修，因为本仓约定不用它们）。

---

## 4. 状态与缓存的落点（"不分散"的清单）

| 内容 | 落点 | 谁设置 |
|---|---|---|
| pi 的 agentDir（配置/技能/会话/扩展） | `<repo>/portable/agent` | `my-pi.sh` 导出 `PI_CODING_AGENT_DIR` |
| 记忆与功能数据 | `<repo>/portable/memory` | `PI_MEMORY_DIR` |
| Node / CPython / 服务 | `<repo>/runtime/<平台>/…` | `scripts/lib-portable.sh` |
| npm 缓存 | `<repo>/runtime/<平台>/npm-cache` | `pi_portable_env`（**强制**，只认 `PI_NPM_CACHE` 覆盖） |
| pip 缓存 | `<repo>/runtime/<平台>/pip-cache` | `pi_portable_env`（只认 `PI_PIP_CACHE` 覆盖） |
| `__pycache__` | `<repo>/runtime/<平台>/pycache` | `PYTHONPYCACHEPREFIX` |
| 服务的 `HOME`/`XDG_*`/`TMPDIR` | `<repo>/runtime/<平台>/ext/<服务>/{home,tmp}` | `pi_service_env` |
| 下载缓存（已校验归档） | `<repo>/runtime/downloads` | `portable-runtime.sh` |

> 为什么 npm 缓存要**强制**（而不是 `${npm_config_cache:-…}`）：从 npm 脚本/CI 里启动 my-pi 时，
> 环境里本来就有 `npm_config_cache=/root/.npm`，"尊重已设置的值"等于把缓存写回用户目录 ⇒
> 便携性**静默失效**。默认值必须由本仓决定（实测踩到）。

---

## 5. 守门与证据

### 5.1 守门（随 `check-conventions.sh` 的 I 段、golden `--fast` 一起跑）

`bash scripts/check-portability.sh` 的四条判据：

| 判据 | 内容 |
|---|---|
| P1 | 生产代码（`scripts/*.sh|*.mjs`、`my-pi.sh`、`custom/**` 非测试）里不得有**仓外绝对路径默认落点**；注释行不算（历史说明要留着） |
| P2 | `runtime/` 必须被 gitignore，且 `git ls-files runtime` 必须为空 |
| P3 | 装了仓内 runtime 时，`pi_resolve_node`/`pi_resolve_python` 必须解析到仓库内；npm/pip/pycache 三者必须指向仓库内 |
| P4 | 制品清单每行 sha256 必须是 64 位十六进制（防手抄/占位） |

### 5.2 搬移测试（按需，不进 pre-commit：约 5–10 分钟）

`bash scripts/test-portability-move.sh` 把整棵树复制到 `/tmp/my-pi-moved-<pid>`，然后用
**最小环境**（`env -i PATH=<git目录>:/usr/bin:/bin`，不提供 node/python）验证七件事：

1. 复制完成 + 可写目录与源仓库断开链接（inode 自证，防测试改到源仓库）
2. `./my-pi.sh --version` 打印版本，且启动行里的 node 路径**在新仓库下**
3. 输出里**不含旧仓库路径**
4. 便携 python + 站点包：`import pypdf/PIL/pdfplumber/pymupdf` 成功
5. `portable-runtime.sh verify` 在新路径下全绿
6. SearXNG 在新路径启动并**真实搜索出结果**（HTTP 200 + results > 0）
7. 扫描旧路径残留（只报告：多为 pip 的 `RECORD`/console script 与 `.pyc` 里的惰性元数据）

**实测（2026-10-15，proot Ubuntu aarch64）**：**7/7 全过**——新路径下的 node、便携 python
与站点包导入、`verify` 全绿（含新增的符号链接污染自证）、SearXNG 在新路径**真实搜出 35 条结果**；
第 7 步只报告了 `site-packages/bin/*`（console script 的 shebang）与若干 `.pyc`/日志里的旧路径
字符串（**惰性元数据**，功能由第 4/6 步证明；本仓一律 `python -m`，不调用这些脚本）。

### 5.3 自证

`bash scripts/portable-runtime.sh verify` 逐条断言：node/python 在仓内、站点包可导入、
三个缓存在仓内、`runtime/` 仍被忽略。本机当前输出：

```
✓ node 在仓内：/root/my-pi/runtime/linux-arm64/node/bin/node（v22.23.1）
✓ python 在仓内：/root/my-pi/runtime/linux-arm64/py/bin/python3（Python 3.12.15）
✓ 站点包在仓内：/root/my-pi/runtime/linux-arm64/ext/py/site-packages
✓ npm 缓存在仓内 / pip 缓存在仓内 / pycache 在仓内
✓ runtime/ 仍被 .gitignore 排除
```

---

## 6. 仍需系统提供的东西（如实列出，别把"便携"说成"零依赖"）

| 依赖 | 状态 | 说明 |
|---|---|---|
| **git** | 需要系统提供 | my-pi 的构建/同步/守门/pi 的 git 功能都要它；Windows 侧由盘内 `runtime/PortableGit` 提供，Linux 侧目前用系统 git（后续可加进 `runtime/<平台>/bin`） |
| `bash` | 需要系统提供 | 同上：Windows 用 PortableGit 的 bash，Linux 用系统 bash（所有发行版都有） |
| `curl` + `tar`（+ `xz`/`unzip`） | 需要系统提供 | 只在**引导**时用（下载并解包运行时）；装好之后运行期不需要 |
| `rg` / `fd` | **已进仓库**（可选但推荐） | `bash scripts/setup-external.sh fd-rg` 会把找到的二进制**复制**进 `runtime/<平台>/bin/` 并写 `portable/agent/bin/` shim（旧写法是 `exec /usr/bin/rg` 这种仓外绝对路径 shim，换机器即失效）；`pi_portable_env` 会把该目录前置进 PATH |
| `age` / `age-keygen` | **已进仓库**（可选但推荐） | `bash scripts/setup-external.sh age` 复制进 `runtime/<平台>/bin`，`scripts/sync-memory.sh`（记忆加密同步）因此不再依赖系统 age。★ **私钥不随之移动**：默认仍在 `~/.config/my-pi/age.key`（仓外），这是刻意的安全边界 |
| ffmpeg / tesseract / ImageMagick / chromium | 按需 | 属于各 pack 的能力（media/pdf/browser），缺失时对应技能降级；同样可放进 `runtime/<平台>/bin` |
| Docker/Podman | 可选 | 只在"用容器起 SearXNG"这条回退路径上用；仓内原生 SearXNG 不需要它 |

**systemd 托管**（可选）：`deploy/systemd/pi-searxng.service` 已按便携布局改写——把 unit 里的
`MY_PI_REPO=` 改成实际仓库路径即可，`SEARXNG_HOME`/`PYTHONPATH`/`SEARXNG_PY` 都由它推导，
并用 `python -m granian` 启动（不用 console script）。该 unit **未在本机用 `systemd-analyze` 校验**
（PRoot 环境无 systemd）✗。

---

## 7. 边界与未核实（✗ 如实）

- **本机只验证了 `linux-arm64`**：清单里另有 `linux-x64` 与 `win-x64` 的 Node、`linux-x64` 的
  CPython（sha256 均来自官方发布物），但**未在对应平台实跑** ✗。
- **voice（whisper/sherpa）未在本机端到端验证**：`faster-whisper`/`sherpa-onnx` 未安装，
  §3.2 的 venv 自愈只做了"路径解析 + 语法 + 幂等"层面的验证 ✗。
- **镜像可用性随时间变化**：本次实测 `ghfast.top`/`mirror.ghproxy.com` 不通、
  `gh-proxy.com`/`ghproxy.net` 通；`nodejs.org` 直连 25 MB 超 10 分钟。清单里的通道顺序可改，
  但**改完必须保持 sha256 校验**。
- **`site-packages/bin/*` 与 `.pyc` 里的旧路径**是惰性元数据（不参与导入/执行），本仓不依赖它们；
  要彻底净化可删 `site-packages/bin`（本仓一律 `python -m`）。
- **PRoot/FUSE 的 `readdir` 不返回 `d_type`**：目录遍历必须 `statSync` 兜底，否则会出现
  "同一守门上一分钟 147 个、下一分钟 0 个"（见 [`../design/CODING-TRAPS.md`](../design/CODING-TRAPS.md) 第 8 条）。

---

## 8. 给后人：加一个新平台 / 新服务

1. **新平台**：在 `scripts/portable-artifacts.txt` 补 `node`/`python` 行（`kind<TAB>platform<TAB>file<TAB>sha256`，
   sha256 用 `sha256sum` 生成），然后 `bash scripts/portable-runtime.sh node && … python`。
2. **新服务**：把安装逻辑加进 `portable-runtime.sh` 的一个子命令，落到 `pi_ext_dir <服务>`；
   启动脚本里用 `pi_service_env <服务>` 沙箱化 `HOME`/`XDG`/`TMP`，并用 `python -m <模块>` 调用。
3. **收尾**：`bash scripts/check-portability.sh` 必须绿；涉及可搬移性时跑一次
   `bash scripts/test-portability-move.sh`，把实测数字写回本文件（不要写"应该可以"）。

---

## 相关

- 卷能力 / Node 版本下限 / 原生模块 / 便携工具链（Windows 实装沿革）：[`BUILD-PORTABILITY.md`](BUILD-PORTABILITY.md)
- 多环境识别与数据隔离：[`ENVIRONMENTS.md`](ENVIRONMENTS.md)
- 盘的选择与重建：[`VOLUME-REBUILD.md`](VOLUME-REBUILD.md)
- 脚本索引：[`../../scripts/README.md`](../../scripts/README.md)
