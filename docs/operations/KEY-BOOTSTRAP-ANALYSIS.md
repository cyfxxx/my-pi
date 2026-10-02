# 私钥引导包分析：把私钥压缩加密后同步到 GitHub 可行吗？

> 需求（用户提出）：把私钥压缩加密后同步到 GitHub，新设备重建时不必再手工搬运私钥。
> **结论：技术上完全可行，但按"哪把钥匙"分开处理——`age` 私钥可以放（口令加密）；
> SSH 私钥不建议搬运，新设备应重新生成。** 依据见下（本项目仓库是**公开**的）。

## 一、现状实测（2026-10-02）

| 事实 | 值 | 影响 |
|---|---|---|
| 仓库可见性 | **公开**（`https://github.com/cyfxxx/my-pi` → HTTP 200） | 任何入库内容都是世界可读；密文只能靠密钥/口令强度 |
| 已入库的加密同步物 | `sync/memory.tar.age`（203 KB）、`sync/age.pub`、`sync/manifest.txt` | 现有设计：**仓库只放密文**，明文永不落库 |
| `age` 私钥位置 | `~/.config/my-pi/age.key`（`600`，仓库外） | 单点：丢失 = 记忆不可解（脚本已写明） |
| 共享存储里的副本 | `/storage/emulated/0/我的文件/my-pi-age.key`（`-rw-rw----`，属组 `aid_everybody`） | **明文私钥在 Android 共享存储**，同组 App 可能可读（FUSE 还会忽略部分权限）→ 建议移出 |
| `manifest.txt` | 明文列出记忆文件 + **最近 5 条会话 ID/时间戳** | 属元信息泄露（内容仍加密）；可接受但要知道 |
| `sync-memory.sh init` | 幂等：私钥已存在则不覆盖，只重写 `age.pub` | 轮换需显式处理（见 §5） |
| 已有校验 | `pub_matches_key()`：`sync/age.pub` 是否由当前私钥导出；`verify --no-key` 可做密文完整性检查 | 换机/轮换时最容易出错的地方已有护栏 |
| 守门 | `check-conventions.sh` 拦截入库的 `*.key`/`*.pem`/`auth.json`/`*-state.json` | 明文私钥**提交不进**；`.age` 不在拦截名单（正是引导包要的） |

## 二、三方案对比

| 方案 | 内容 | 新设备步骤 | 风险 |
|---|---|---|---|
| **A（推荐）** | 引导包只放 **`age` 私钥**（+ 非敏感配置），`age -p` 口令加密后入库 | clone →（生成新 SSH key 并在网页添加）→ 输口令解出 `age.key` → `verify` | 口令是唯一防线；忘记口令 = 记忆不可解（与现状"丢私钥"等价，载体变成口令） |
| B | 引导包**同时放 SSH 私钥** | clone（？）→ 解包即得写权限 | **循环依赖**：拉包要先有凭据；**公网仓库里放账号级写权限**；一旦口令弱/泄露，攻击者同时拿到记忆 + 推送权限 |
| C | 不放 GitHub：密码管理器 / Syncthing（已装）/ 私密仓库 Release / 纸质 | 从对应渠道取 | 依赖另一个服务；但**不扩大 GitHub 单点**，且支持 2FA |

## 三、为什么 SSH 私钥不要搬运（关键）

1. **循环依赖**：`ssh://git@ssh.github.com/...` 的凭据就是那把 SSH 私钥；把它放进这个仓库，
   新设备会陷入"要拿钥匙得先有钥匙"。必须有**仓库外**的第二个凭据（PAT 或纸质），否则引导包没有意义。
2. **权限放大**：SSH key 若同时注册在 GitHub 账号上，泄露 = **账号级**写权限（不止这一个仓库）；
   而它现在会躺在**公开仓库**里，任何人有空就能离线爆破口令。
3. **其实不需要搬运**：新设备 `ssh-keygen` 生成新 key → 用密码 + 2FA 登录 GitHub 网页添加公钥 → 立即可用。
   这是标准做法，既不搬运私钥，也能顺手做**轮换**（旧设备丢失时正好吊销）。

## 四、推荐设计（方案 A，供确认后实现）

新增 `scripts/bootstrap-key.sh`（与 `sync-memory.sh` 同一密钥/目录约定）：

```bash
bootstrap-key.sh pack    # tar(age.key [+ 非敏感配置]) | age -p -o sync/bootstrap.age（口令输两遍、umask 077）
bootstrap-key.sh unpack  # age -d sync/bootstrap.age → ~/.config/my-pi/age.key（chmod 600）→ 打印指纹
bootstrap-key.sh verify  # 解出后核对 age.pub 指纹一致（复用 pub_matches_key 逻辑）+ 提示跑 sync-memory.sh verify
```

硬性要求：

1. **口令**：≥6 词 diceware（≈77 bit）或密码管理器生成的 20+ 随机字符；**不复用**任何其他口令。
   `age -p` 用 scrypt（抗暴力），但口令熵才是决定性因素。
2. **只装"解密材料"**：`age.key` + 引导说明；**不放** SSH 私钥、`auth.json`、`settings.json` 的 deviceId。
3. **落盘纪律**：解包后 `chmod 600`、目录 `700`；不要把明文私钥放 `/storage/emulated/0`（共享存储）。
4. **守门**：`check-conventions.sh` 增加两条——① 禁止 `sync/` 下出现 `*.key`/`*.pem` 明文（现有规则已覆盖全局）；
   ② 若存在 `sync/bootstrap.age`，要求同目录有 `bootstrap.README.md`（写明口令来源与轮换步骤，避免"无人记得怎么解"）。
5. **自动化测试**：`scripts/test-bootstrap.sh` 用**临时口令 + 临时密钥**造包/解包/指纹校验（不打真实包、不碰真实私钥），
   接入 golden；真实引导包只做"能否解开"的人工演练。
6. **轮换流程**（写进 `sync/README.md`）：`age-keygen -o newkey` → `init` 改写 `age.pub` → `push` 重加密 bundle →
   `bootstrap-key.sh pack` 刷新引导包 → 新设备演练 → 旧私钥销毁。
7. **演练**：引导包必须在一台干净环境里真跑过一次恢复（clone → 解包 → `sync-memory.sh verify`），
   否则等于没有备份（与项目"报告→确认→快照→执行→验证"一致）。

## 五、风险清单与缓解

| 风险 | 缓解 |
|---|---|
| 口令弱 → 公开仓库离线爆破 | 强口令（diceware≥6 词/20+ 随机字符）；`age -p` scrypt；发现问题立即轮换 |
| 忘记口令 | 口令存密码管理器 + 纸质备份；**同时**保留 `age.key` 的离线备份（两条独立路径） |
| Git 历史不可撤（误提交明文） | 提交前 `check-conventions` 拦截；一旦发生：`git filter-repo` + **立刻轮换** age key 与 SSH key |
| 明文落盘/共享存储 | 解包即 `600`、目录 `700`；移出 `/storage/emulated/0`；用完即删 |
| GitHub 账号单点 | 开 2FA；**SSH 私钥不入库**；PAT 用 fine-grained + 最小权限 + 短有效期 |
| 仓库公开 → 元信息泄露 | 已知：`manifest.txt` 列出会话 ID；若在意，可把 manifest 也加密，或只列"memory/*"通配 |
| 第三方 App/CI 读取仓库 | 不装无关 GitHub App；不在 Actions 里跑需要密钥的任务 |

## 六、结论与待你选择

- **可行**，且本项目已有 90% 的底座（age 加密同步 + 公钥校验 + 密文入库 + 明文守门）。
- **推荐 A**：引导包只放 `age` 私钥（口令加密），SSH 私钥不搬运、新设备重新生成。
- 备选 C 更保守（密码管理器/Syncthing/私密仓库 Release），代价是多一个渠道要维护。
- B（含 SSH 私钥）只在"确实无法在新设备登录 GitHub 网页"时才考虑，且必须配仓库外的独立引导凭据。

**已决（2026-10-02）：选方案 A，并已落地。**

- `scripts/bootstrap-key.sh`：`pack`（`age -p` 口令加密 → `sync/bootstrap.age` + 明文 `bootstrap.meta.json`）/
  `verify`（白名单成员 + 指纹核对，不安装）/ `unpack [--yes]`（装到私钥路径、600、覆盖留 `.bak`）。
  硬约束：成员白名单只有 `age.key` + 一页说明；**拒绝**仓库内私钥；**拒绝**夹带 `id_ed25519` 等文件；
  自动扫描并告警共享存储里的明文私钥副本。
- `scripts/test-bootstrap.sh`（13 项，全程临时密钥）接入 golden **第 16 步**；`check-conventions.sh` 增加
  "有 `sync/bootstrap.age` 就必须有 `sync/bootstrap.meta.json`"。
- `sync/README.md` 增加「引导包」章节（pack/unpack/verify、口令强度、轮换流程、干净环境演练、共享存储告警）。
- **待你决定（未动）**：共享存储里那份明文私钥 `/storage/emulated/0/我的文件/my-pi-age.key` 是否清理
  （脚本已能持续告警；删除/移动属你的备份决定）。

## 七、干净环境演练结果（2026-10-02，`/tmp/my-pi-bootstrap-rehearsal`）

在**临时目录**模拟一台新设备（公开仓库无需任何凭据）：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 1 检出 | `git clone --depth 1 https://github.com/cyfxxx/my-pi.git` | ✅ 无凭据克隆成功，`HEAD = 91f19d9`（24 MB） |
| 2 取到的包是否对 | `sha256sum sync/bootstrap.age` vs `sync/bootstrap.meta.json` | ✅ `58a59e3d…` 一致 |
| 3 无密钥能做什么 | `bash scripts/sync-memory.sh verify --no-key` | ✅ age v1 头部完整（"私钥可用时重跑可校验可解密性"） |
| 4 口令模式全链路 | 一次性密钥/口令跑 `bootstrap-key.sh pack` → `unpack`（同一条生产代码路径） | ✅ 1082 B 包 → 安装到 `~/.config/my-pi/age.key` 权限 `600` → 指纹与源一致 |
| 5 真实包解包 | 需**你的口令**（我无法代输） | ⏳ 见下方命令 |

**演练目录里唯一待做的一步**（真实引导包 + 你的口令）：

```bash
cd /tmp/my-pi-bootstrap-rehearsal/my-pi
bash scripts/bootstrap-key.sh unpack --yes      # 输口令 → 写到该演练 HOME 下
bash scripts/sync-memory.sh verify              # 应输出"可解密、清单一致、JSON 有效"
```

> ⚠️ **演练目录里绝不要执行 `sync-memory.sh push`**：那个 clone 的记忆是空的/过期的，
> push 会用它重新加密并覆盖 `sync/memory.tar.age`。演练完直接 `rm -rf /tmp/my-pi-bootstrap-rehearsal`。

## 八、轮换预案（已记录，尚未执行）

**触发条件**：口令疑似泄露 / 明文私钥副本曾在不可信位置出现 / 想更换设备归属。

**前置**：新口令已存密码管理器 + 纸质；选一个低风险时间窗；先把 `portable/memory/entries.json` 与整个 `sync/`
拷到离线介质（这一步是"万一失败还能退回"的唯一保障）。

```bash
# 1) 备份（离线介质）
cp -a portable/memory/entries.json /path/to/offline/backup/
cp -a sync /path/to/offline/backup/sync-$(date +%F)

# 2) 移走旧私钥（不删，留作过渡与回退）
mv ~/.config/my-pi/age.key ~/.config/my-pi/age.key.old-$(date +%s)

# 3) 生成新钥 + 刷新仓库公钥（此后旧 bundle 仍只有旧钥能解，这是预期的过渡态）
bash scripts/sync-memory.sh init          # 新 age.key(600) + 写 sync/age.pub

# 4) 用新钥重加密记忆/会话（覆盖 sync/memory.tar.age）——**切换完成以这一步为准**
bash scripts/sync-memory.sh push

# 5) 复核
bash scripts/sync-memory.sh verify

# 6) 刷新引导包（新口令，可与旧口令不同）
bash scripts/bootstrap-key.sh pack --force

# 7) 提交（显式路径；不要 git add -A）
git add sync/age.pub sync/memory.tar.age sync/bootstrap.age sync/bootstrap.meta.json
git commit -m 'chore(sync): 轮换 age 密钥并重加密记忆'
git push

# 8) 干净环境演练（同 §七）：clone → sha256 核对 → unpack → verify → pull → 与备份比对条目数

# 9) 销毁旧材料
rm -f ~/.config/my-pi/age.key.old-* /path/to/offline/backup/sync-*/memory.tar.age   # 旧密文按需保留
# 若怀疑旧钥已泄露：同时吊销并更换 SSH key（网页删除旧公钥 + ssh-keygen 新的）

# 10) 记录：在 PROGRESS 写一条（时间/原因/新指纹/演练结果）
```

**关键注意**：

1. 步骤 3→4 之间处于"半切换"状态（仓库里还是旧钥加密的 bundle）：**必须走完 4** 才算轮换完成。
2. 若旧钥已丢失且无备份 → 旧 bundle 不可解，只能以**当前设备上的 `entries.json`** 为准重新 push（等于以现状为新的起点）。
3. **age 密钥轮换与 SSH 密钥轮换是两件事**：前者管加密数据，后者管仓库推送权限；怀疑泄露时通常两者都要做。
4. `memory.tar.age` 是历史包袱最少的一环（只有一份密文），轮换代价主要在"找不到旧钥就丢历史"。
