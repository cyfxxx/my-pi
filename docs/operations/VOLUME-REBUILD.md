# 便携卷的选择与重建（Runbook）

> 适用：把 my-pi 放在移动硬盘 / U 盘上长期使用，或需要重建、迁移、加密该盘时。
> 与 [`BUILD-PORTABILITY.md`](BUILD-PORTABILITY.md) 的分工：那份讲**怎么把依赖建起来**，
> 这份讲**盘本身怎么选、怎么重建、怎么验证数据没丢**。
>
> **本文件的每一步都有"验证门槛"：未通过不得进入下一步。**

---

## 0. 速查：卷怎么选

| 卷 | 符号链接 | 4KB 簇 | 文件属主 | 可靠性与日志 | 建议 |
|---|---|---|---|---|---|
| **NTFS** | ✅ | ✅ | ✅ | ✅ 元数据有日志 | **首选**（数据分区与工具分区都可用） |
| exFAT | ❌ | ✅（**必须显式指定**） | ❌ | ❌ 无日志 | 仅在需要给电视/相机/车机读取时用于**未加密**分区 |
| FAT32 | ❌ | ✅ | ❌ | ❌ 无日志 | 不用（单文件 4GB 上限） |

**两条硬结论（实测，详见 §1）**：

1. **exFAT 的簇大小可以选 4KB，但默认常被选成 1MB** —— 这是本盘踩过的最贵的坑。
2. **NTFS 是唯一同时满足"能装依赖 + 可加密 + 有日志抗损坏"的选择**，
   而它给 Linux 的读写（内核 `ntfs3`）已经够用。

---

## 1. 第一优先：确认簇大小（1 MB 簇是最贵的坑）

### 症状与代价

`fsutil` / `Get-Volume` 看 `AllocationUnitSize`。若是 **1048576（1 MB）**，
则**每个文件至少占 1 MB**，磁盘占用由**文件数**决定，而不是字节总量：

| 内容 | 文件数 | 逻辑大小 | 1 MB 簇实占 | 4 KB 簇实占 |
|---|---|---|---|---|
| 一个 1,334 文件 / 278 GB 的目录 | 1,334 | 278.63 GB | 279 GB | 278.6 GB |
| **my-pi 仓库**（含 vendor/） | 44,160 | 0.71 GB | **43.1 GB** | 约 0.75 GB |
| 便携工具链（Git + Node） | 8,254 | 421 MB | **9.49 GB** | **447 MB** |
| 整盘用户数据 | 80,105 | 516.11 GB | 约 599 GB | 516.30 GB |

**21 倍差距**（工具链 9.49 GB vs 447 MB）。当年这块盘被格式化成 1 MB 簇，
让一个 0.71 GB 的项目实占 43.1 GB —— 而 `du -sh` 报的数字会让人以为盘要满了。

### 判据与验证

```powershell
# 看每个分区的分配单元（关键数字：必须是 4096，不是 1048576）
Get-Volume | Select-Object DriveLetter, FileSystem, AllocationUnitSize,
  @{n='SizeGB';e={[math]::Round($_.Size/1GB,1)}}

# 交叉验证：写 200 个 1KB 文件，按可用空间差值反推簇大小
$t='H:\_clustertest'; New-Item -ItemType Directory $t -Force | Out-Null
$before=(Get-Volume -DriveLetter H).SizeRemaining
1..200 | % { [IO.File]::WriteAllText("$t\f$_.txt",'x'*1024) }
$after=(Get-Volume -DriveLetter H).SizeRemaining
"实际消耗 $([math]::Round(($before-$after)/1MB,2)) MB → 推算簇大小 $([math]::Round(($before-$after)/200/1KB)) KB"
Remove-Item $t -Recurse -Force
# 4KB 簇 → 约 0.82 MB（簇大小 4KB）；1MB 簇 → 约 200 MB（簇大小 1024KB）
```

**exFAT 也支持 4096**（`format /?` 明确列出 `512…4096…32M`），所以
"1 MB 簇"不是 exFAT 的强制行为，**是格式化时的选择**。重建时务必显式指定。

---

## 2. 第二优先：文件系统选择

### 为什么数据分区选 NTFS

| 判据 | NTFS | exFAT |
|---|---|---|
| 元数据日志（抗不安全拔出） | ✅ | ❌ |
| 记录文件属主（`safe.directory` 问题少一半） | ✅ | ❌ |
| 保留脚本执行位（`100755`） | ✅ | ❌ |
| 在盘上直接 `npm install` | ✅ | ❌（无符号链接） |
| 电视/相机/车机直接读 | ⚠️ 多数只认 exFAT | ✅ |

**一个反直觉的推论**：**加密会消灭 exFAT 的最大优势**。
exFAT 的价值是"即插即用"，但加密分区**必须先在电脑上解密才能访问** ——
那些第三方设备根本读不了。所以数据分区用 exFAT 拿不到它的长处，却要承担无日志的风险。

### 何时仍该用 exFAT

**未加密的工具分区**：它的设计目标就是"任何设备插上都能读"，
要放 VeraCrypt 便携版、便携工具，exFAT 正合适。

### 本盘实测（已落地）

| 分区 | 卷标 | 大小 | 文件系统 | 分配单元 |
|---|---|---|---|---|
| 数据（加密） | DATA | 约 899.5 GB | **NTFS** | **4096** |
| 工具（不加密） | TOOLS | 32 GB | exFAT 或 NTFS | **4096** |

> 工具分区 32 GB 的依据：工具链合计 < 200 MB（VeraCrypt 便携版 ~100 MB +
> Linux console 版 ~30 MB + fd/rg 等 < 20 MB），其余留给临时文件。

---

## 3. 重建流程（backup → verify → format → encrypt → restore → verify）

> ⚠️ **数据安全总原则**：备份验证通过前，不得执行任何分区/格式化操作；
> 回迁完成后，备份至少保留 **1–2 周**再删。

### 阶段 0：建立基线清单（**不可跳过**）

在任何拷贝之前，先记录"盘上到底有什么"。这是后续验证的**唯一可信基准**。

```powershell
python - <<'PY'
import os
H = "H:" + os.sep
with open(r"E:\baseline.tsv", "w", encoding="utf-8", newline="\n") as mf:
    mf.write("size_bytes\trelative_path\n")
    for dp, dn, fns in os.walk(H, onerror=lambda e: print("ERR", e)):
        for fn in fns:
            full = os.path.join(dp, fn)
            try: sz = os.stat(full, follow_symlinks=False).st_size
            except OSError as e: sz = -1; print("ERR", full, e)
            mf.write(f"{sz}\t{os.path.relpath(full, H)}\n")
PY
```

**要点**：
- 用 Python / `Get-ChildItem`，**不要用 `[System.IO.Directory]::EnumerateFiles()`**
  —— 它在损坏的 exFAT 上会**静默返回空**（见 §5.2）
- **对清单本身做抽样校验**（抽 10+ 项回源盘核对大小），否则基准不可信
- 读不到的文件**如实记为 -1**，不要替它猜一个大小

### 阶段 1：复制（不移动）

```powershell
robocopy H:\ 'E:\_备份\data' /E /COPY:DAT /DCOPY:DAT /R:2 /W:5 /XJ /MT:8 /NP /TEE /LOG:'E:\_备份\robocopy.log'
```

- `/R:2 /W:5`：损坏文件只重试 2 次，避免卡死在坏文件上
- `/XJ`：跳过 junction，防自引用死循环
- **绝不加 `/MOVE`** —— 源盘一个字节都不删

### 阶段 2：验证（**通过前绝不动源盘**）

用阶段 0 的清单逐条对账，而不是"数一下文件个数对不对"：

- 清单里的每个文件，副本必须**存在且大小一致**
- 清单里记为 -1 的（源盘不可读）**豁免并单独列出**
- 差异逐项查清后才算通过

### 阶段 3：格式化

```powershell
# 一个分区：
format H: /FS:NTFS /A:4096 /Q /V:DATA
# 或脚本化：
Format-Volume -DriveLetter H -FileSystem NTFS -AllocationUnitSize 4096 -NewFileSystemLabel 'DATA' -Confirm:$false
```

**门槛**：`AllocationUnitSize` 必须显示 **4096**，否则重做。

### 阶段 4：加密（若需要）

- 加密**前**先决定整盘加密还是容器（见 §4）
- 整盘加密会把整个分区写一遍，**期间不得断电/拔盘/休眠**
- 加密后**立刻备份卷头并演练恢复**（见 §4.2）

### 阶段 5：回迁

```powershell
robocopy 'E:\_备份\data' 'M:\' /E /COPY:DAT /DCOPY:DAT /R:2 /W:5 /XJ /MT:8 /NP /TEE `
  /XD 'FOUND.000' 'System Volume Information' '$RECYCLE.BIN' `
  /LOG:'E:\_备份\robocopy-restore.log'
```

`/XD` 排除的三个目录是旧 exFAT 的损坏残留与系统目录，对 NTFS 无意义。

### 阶段 6：回迁后验证（用同一份清单）

**必须能用清单解释每一个差异**。本盘的实际结果：

| 项 | 数 |
|---|---|
| 副本清单总数 | 80,084 |
| 减 `/XD` 排除的系统目录 | −378（`$RECYCLE.BIN` 369 + `FOUND.000` 6 + `System Volume Information` 3）|
| = 应有（递归可见） | 79,706 |
| 加 Windows 自动重建的回收站配置 | +1（`$RECYCLE.BIN\S-1-5-21-…\desktop.ini`）|
| = 实测递归可见 | **79,707** ✓ |
| 加不参与递归枚举的两个目录 | +20 |
| = 实际文件总数 | **79,727** |

---

## 4. 加密：整盘还是容器

### 4.1 选择的判据

| | 整盘加密 | 容器文件（放在普通 NTFS 分区上） |
|---|---|---|
| 防丢失泄露 | ✅ 整个分区 | ✅ 仅容器内 |
| 未装加密软件的机器 | ❌ 整盘都读不了 | ✅ 容器外的文件照常读 |
| 后期扩容 | 麻烦（需导出→重建卷→导回） | 容易（可另建容器） |
| 边界清晰度 | 高（"除了工具，全是密的"） | 依赖自觉判断什么该放进去 |

**推荐整盘加密 + 一个不加密的逃生分区**：边界最清晰，不容易犯
"以为加密了、其实把敏感文件丢在未加密区"的错。且加密软件本身必须放在未加密分区，
否则会出现"要解密才能拿到解密工具"的死锁。

### 4.2 卷头备份（**唯一的不可逆风险点**）

> **卷头损坏 = 数据永久不可恢复，即使你记得口令。**

1. 加密完成后**立刻**：`Tools → Backup Volume Header`
2. 存到 **≥2 处**，且**不要只存在被加密的那个盘自己身上**
3. **演练一次** `Tools → Restore Volume Header`

第 3 步不能省："备份了"和"备份能用"是两回事，只有演练过才知道文件真的可用。

### 4.3 加密对性能与寿命的影响（实测）

| 项 | 实测值 |
|---|---|
| 单核 AES-256-XTS 吞吐 | **8.63 GB/s** |
| AES-NI 硬件加速 | 已启用（openssl `AESNI_ASM`/`VPAES_ASM`） |
| 本盘 USB 实测速率 | 359 MB/s |
| 加密能力 / USB 带宽 | 约 **24 倍** → 加密不是瓶颈 |
| 加密 CPU 占用 | 约 4% 单核 |

寿命：初始加密的一次性全盘写入约 0.9 TB，约等于消费级 SSD 耐久度的 **0.3%**；
日常使用加密**不增加对 SSD 的写入量**（数据在内存加密后才落盘，无写放大）。

---

## 5. 回迁后的三个验证陷阱（都会导致错误结论）

### 5.1 单位口径：robocopy 的 `g` 是 GiB，不是 GB

`516.014 g` = 516.014 **GiB** = **554.07 GB**。
用 `字节 / 1GB`（十进制）去对账会看到"少了 2.5 GB"的假差异。

**做法**：对账时**统一到字节或统一到 GiB**，不要混用。

### 5.2 别用 `EnumerateFiles` 建立目录索引

实测：`[System.IO.Directory]::EnumerateFiles()` 在损坏的 exFAT 上
**静默返回空结果**（不抛异常、不报错），而同一路径 `Get-ChildItem` / `Test-Path` 正常。
用它建索引会把真实存在的文件误报为"缺失"。

**做法**：用 `Get-ChildItem -Recurse -File -Force` 或 Python `os.walk`。

### 5.3 "不参与递归枚举"的目录：存在但看不见

本盘有两个目录（名带前导空格的 ` DOCUMENT873` 与 `ZUSER249`）：
**能按名直接访问、文件完好，但递归枚举与资源管理器都看不见**。

后果：`Get-ChildItem -Recurse` 的总数比实际少；据此对账会得出"丢了 20 个文件"的错误结论。

**做法**：对账时**按名补齐**这类目录，或在结论里明确说明它们的存在与数量。

---

## 6. 新盘的使用纪律

| 纪律 | 原因 |
|---|---|
| **每次拔盘前先卸载加密卷，再"安全删除硬件"** | 未卸载直接拔盘会损坏加密卷；本盘此前就因不安全拔出导致过 exFAT 元数据损坏 |
| 加密/大文件传输中不断电、不休眠 | 即使 NTFS 有日志，写中断仍可能损坏 |
| 每季度只读体检 | `chkdsk <盘> /scan`（只读，不改动）或看 `Get-Volume` 的 `HealthStatus` |
| 关键数据保留第三份 | 移动硬盘是**搬运工具**，不是备份。单盘一份 = 单点故障 |
| 口令、卷头备份、盘本体三处分离 | 放在一起等于没加密、没备份 |
| 未加密分区只放工具与**非敏感**临时文件 | 任何人捡到都能读 |

---

## 7. 换机器时要做的两件事

1. **登记 `safe.directory`**（否则 git 报 `dubious ownership`）：
   ```bash
   git config --global --add safe.directory M:/my-pi
   git config --global --add safe.directory M:/my-pi/vendor/pi
   ```
   - exFAT 上触发原因是**卷不记录属主**
   - **VeraCrypt 卷上触发原因是属主为 Administrators**（实测）
   - 两者表现相同、根因不同，但修法一致

2. **挂载加密卷**：加密卷重启后不会自动挂载。便携启动器会搜索所有盘符找仓库，
   所以盘符变了也不影响；找不到时会给出"加密卷可能未挂载"的提示。

---

## 相关

- 构建与便携性（Node 版本下限 / 卷能力 / 原生模块 / 完全便携）：[`BUILD-PORTABILITY.md`](BUILD-PORTABILITY.md)
- 失败模式台账（本流程踩过的坑都在里面）：[`../BUG-REPLAYS.md`](../BUG-REPLAYS.md)
- 上游同步：[`UPSTREAM-UPDATE.md`](UPSTREAM-UPDATE.md)
- 多环境识别与数据隔离：[`ENVIRONMENTS.md`](ENVIRONMENTS.md)
