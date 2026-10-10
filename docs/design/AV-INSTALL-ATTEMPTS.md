# 第三方杀毒/静态分析：安装尝试与结论（2026-10-10）

## 结论先行

**走通了的路 = apt 系统包**（不是 pip）：本环境是 proot-distro 的 Ubuntu，`apt-get` **可用（apt 2.8.3 arm64）**，
且**国内镜像可达**（实测 `python3-pefile` 的候选版本来自 `mirrors.cloud.tencent.com/ubuntu-ports`）。

| 尝试 | 结果（实测） |
|---|---|
| `apt-get install -y --no-install-recommends python3-pefile` | **装上 ✓**，`import pefile` → **2023.2.7** |
| `apt-get install -y --no-install-recommends python3-yara` | **装上 ✓**，`import yara` → **4.5.0** ✅ **这是本轮最有价值的收获** |
| `apt-get install -y --no-install-recommends python3-oletools` | **失败 ✗**（该发行版仓库里没有这个包；见 `/tmp/apt-python3-oletools.log`） |
| ClamAV | **未安装**；且**官方病毒库实测 `000 / size=0`** ⇒ 装了也无库（此路已判定不通） |

## 为什么 YARA 是关键收获

**YARA 是规则引擎，不需要病毒库** —— 它只需要**规则文件**（可自写、也可用公开规则集）。
这正好绕开 ClamAV 的死结（死结在库不在引擎）。所以：

- **能力升级**：从"只能算哈希 + 看结构"升级到"**可以跑真正的特征匹配**"（例如标记可疑脚本、挖矿特征、
  混淆片段、宏里的可疑调用）；
- **仍然诚实**：没有规则文件 / 引擎不在 ⇒ 结论照旧是 **`not-scanned`**，**绝不显示绿色**。

## ClamAV 的最终判定（写死，不再重复试）

- 引擎：本环境**未安装**；
- 库：官方 `database.clamav.net` 实测 **000（size=0）**；早前实测 tuna/ustc/aliyun 的 `/clamav/` **三个都 404**
  （域名活着、路径不存在）；
- ⇒ **判定：在当前网络下 ClamAV 不可用**（不是"没试"，是"试过并有了字节数证据"）。**不再重复尝试**；
  若将来网络条件变化（例如经由宿主代理），再复测一次即可。

## 下一步（建议接成"可选 L3 层"）

在 `scripts/security-scan.mjs` 里加 **可选 L3 = YARA**：有 `yara` 引擎 + 有规则文件才跑；
否则记 **`not-scanned`**（与现有三态一致）。**默认关、显式调用**（改默认需用户批准）。
`pefile` 可作为"PE 结构"的补充（解析导入表/节表/是否带签名壳），同样**缺失即 `not-scanned`**。
