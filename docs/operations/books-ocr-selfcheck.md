# 书籍自检硬依赖 RapidOCR：装机与救急（Runbook）

> 适用：在**新机 / 新环境**上第一次提交时，被 `pre-commit` 的 golden 第 15 步挡住；或书籍自检直接报 OCR 不可用。
> 与 [`BUILD-PORTABILITY.md`](BUILD-PORTABILITY.md) 的分工：那份讲 Node 版本下限与卷能力，这份只讲**"OCR 引擎缺失"这一类**。
>
> **本文件的每一步都有"验证门槛"：未通过不得进入下一步。**

---

## 0. 速查

| 你看到的现象 | 一行处置 |
|---|---|
| 提交被拦，日志尾部是「书籍框架自检失败（通过 20 / 失败 1）」 | 按 §2 装 OCR 引擎（venv + `.pth` 桥接） |
| 只想**让自检不再硬失败**，暂时不装任何引擎 | `PI_BOOKS_OCR_ENGINE=tesseract`（§4；**有明确限制**，别当成装了引擎） |

**一条要记住的事实**：同为"OCR 引擎不可用"，**tesseract 缺失 ⇒ 跳过**，而 **rapidocr 缺失 ⇒ 硬失败** ——
两者降级策略相反（§1 有出处）。所以本机缺的若是 rapidocr，**任何提交都过不了 `pre-commit`**。

---

## 1. 症状 → 根因

### 症状（真实遇到过的那次）

拉取远端更新后，第一次提交被拒，golden 尾部逐字如下：

```
  ❌ 书籍框架自检（见 /tmp/golden-books.log）
  ❌ 扫描件 OCR（tesseract 缺失则跳过）  [OCR 引擎 rapidocr 不可用：缺 rapidocr_onnxruntime（安装：python3 -m pip install rapidocr-onnxruntime onnxruntime）]
❌ 书籍框架自检失败（通过 20 / 失败 1）
❌ golden tasks 失败 1 项

pre-commit：golden --fast 未通过，提交已阻止。
```

### 根因

1. 书籍自检入口是 **`node scripts/test-books.mjs`**，由 `scripts/golden-tasks.sh:108` 调用 ⇒ 它是 **`pre-commit` 的一部分**。
2. 该自检默认走 **rapidocr** 引擎（`scripts/books.py:62` 的 `"ocr_engine": "rapidocr"`）⇒ **硬依赖** `rapidocr_onnxruntime`。
3. 于是"本机没装 OCR 引擎"不再是一条**可跳过的环境限制**，而是**硬失败** ⇒ **提交被拦**。

### 为什么说这是"降级策略不一致"（记录，不要在这里改守卫）

- **tesseract 缺失**：自检**跳过**（同一行输出里写着"tesseract 缺失则跳过"）。
- **rapidocr 缺失**：自检**失败**。

同一个语义（"OCR 引擎不可用"）走了两条相反的分支。**本文件只负责让你能干活**；要不要把守卫改成一致的
"缺引擎 ⇒ 跳过 + 明确提示"，属于**守卫自身的改动**，应在另一次改动里做，且**不要**为了让提交过去而放宽断言。

### 判据（30 秒确认本文件适不适用）

```bash
node scripts/test-books.mjs; echo "rc=$?"
# rc != 0 且输出含「OCR 引擎 rapidocr 不可用」 ⇒ 就是这一类，往下走 §2

python3 -c "import rapidocr_onnxruntime" 2>&1 | tail -1
```

---

## 2. 安装（已在本机实测通过）

> **前提**：Debian 系（或任何启用 **PEP 668** 的发行版）**不要**用 `pip install --break-system-packages`，
> 也不要用 `sudo pip` —— 那是在动系统 Python，**有把系统包管理器弄坏的风险**。

**步骤 1：建一个专用 venv**（放仓库外，避免污染仓库；本项目守门本身也忽略 `.venv`）

```bash
python3 -m venv /opt/pi-books-venv
```

**步骤 2：装引擎**

```bash
/opt/pi-books-venv/bin/pip install rapidocr-onnxruntime onnxruntime
```

**本机实测**（供对照，不是必须完全一致）：

| 包 | 实测版本 |
|---|---|
| `rapidocr-onnxruntime` | **1.4.4** |
| `onnxruntime` | **1.31.0** |

- 走的是**清华镜像**（`pypi.tuna.tsinghua.edu.cn`）⇒ 成功；**体积较可观**（会连带 `opencv-python`、`numpy`、`Pillow` 等），
  下载可能需要几分钟。
- venv 内自证：

```bash
/opt/pi-books-venv/bin/python3 -c "import rapidocr_onnxruntime, onnxruntime; print('ok')"
```

**步骤 3：桥接**（让**系统 `python3`** 也能看到 venv 里的包 —— 自检调用的就是 `python3`）

先把 venv 的 site-packages 路径写进一个 `.pth` 文件：

```bash
V=/opt/pi-books-venv
SP=$(python3 -c "import site; print(site.getsitepackages()[0])")   # 本机实测：/usr/local/lib/python3.12/dist-packages
echo "$V/lib/python3.12/site-packages" > "$SP/zz-pi-books-venv.pth"
```

**注意**：这条路径里含 **`python3.12`** —— **换 Python 版本（小版本也算）就必须改这个数字**，
否则桥接指向一个不存在的目录，症状会**原样复发**（而 `.pth` 文件本身还在，更容易误判）。

**步骤 4：验证（这一步不过就别提交）**

```bash
python3 -c "import rapidocr_onnxruntime, onnxruntime; print('系统 python3 可见 ✓')"
node scripts/test-books.mjs; echo "rc=$?"
```

通过的标准是本机实测原文：

```
书籍知识库框架自检通过（20 项；含 OCR 兜底与 report 去重回归）
rc=0
```

---

## 3. 会看到的无害告警（别据此以为装失败）

`onnxruntime` 起来时会打印类似：

```
[W:onnxruntime:Default, device_discovery.cc:484 DiscoverDevicesForPlatform]
GPU device discovery failed: ... filesystem path: "/sys/class/drm" ... Permission denied
```

这是**探测 GPU** 时读不到 `/sys/class/drm` ⇒ **自动走 CPU**，**无害**，与"装没装上"无关。
判据始终是 §2 步骤 4 的 `rc=0`。

---

## 4. 替代开关：只想"不再硬失败"（不装引擎）

项目留了引擎选择位（`scripts/books.py:141` 读 `PI_BOOKS_OCR_ENGINE`）：

```bash
PI_BOOKS_OCR_ENGINE=tesseract node scripts/test-books.mjs; echo "rc=$?"
```

- 这时若 **tesseract 也缺失** ⇒ 自检**跳过该项**（不会硬失败）⇒ 你可以提交了。
- **但必须理解它的边界**：这**只是让自检别再硬失败**，
  **不等于你装上了 OCR 引擎** —— 真正要 OCR 扫描件时仍然做不了（或只能走很慢的 tesseract 路线）。
- 因此这条适合"临时救急 / 这台机器不做 OCR"，**不适合**当作长期方案。

---

## 5. 回滚（把本机恢复成没装过的样子）

```bash
rm -f /usr/local/lib/python3.12/dist-packages/zz-pi-books-venv.pth   # 断开桥接（删它即回滚 ✓）
rm -rf /opt/pi-books-venv                                            # 想彻底清掉 venv 时再做
```

删掉 `.pth` 之后，系统 `python3` 立刻看不到那两个包；**自检会重新变红** —— 这是预期，不是新故障。

---

## 6. 一条相关事实（只一行，避免误判工具链）

本机**不存在** `<repo>/runtime/` 时，工具链解析会退回历史布局（`scripts/lib-vendor.sh:87` 依次找
`<repo>/runtime/node/` → `<repo>/../runtime/node/`），**这是正常的**，不要因此认为"工具链坏了"。

---

## 7. 未覆盖 / 存疑

- 本文件记录的是 **Linux（/opt + 系统 dist-packages）** 上的实测路径与版本；**Windows / macOS 未验证**。
- 版本号（1.4.4 / 1.31.0）是**当时的实测值**；换时间安装可能拿到更新版本 —— 判据仍以 §2 步骤 4 的 `rc=0` 为准。
- `.pth` 桥接会让系统 `python3` 多看到一批包（`opencv-python`、`numpy`、`Pillow` 等）。若你的项目还依赖**别的 numpy/Pillow 版本**，
  请注意这条桥接的**可见性是全局的**；需要隔离时改用 `PI_BOOKS_OCR_ENGINE` 或直接调用 venv 里的 python。
- 本节之外，守卫为何对两种引擎采用相反降级策略**没有查到设计文档依据** ⇒ 属**未核实**。
