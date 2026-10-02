# sync — 加密同步（长期记忆 / 选定会话）

本目录放 **age 加密后的密文**，用于把 `portable/` 下默认不入库的长期记忆与选定会话
同步到 GitHub，便于跨设备继续任务。明文永不落入本目录或提交。

## 文件

| 文件 | 是否提交 | 说明 |
|------|----------|------|
| `age.pub` | 是 | age 公钥（用于加密） |
| `manifest.txt` | 是 | 待同步文件清单（相对仓库根，每行一个） |
| `memory.tar.age` | 是 | 加密打包（记忆 + 选定会话） |
| `.local-backup-*.tgz` | 否 | `pull` 覆盖前的本地备份（已 gitignore） |

私钥默认在 `~/.config/my-pi/age.key`，**不在仓库内**，必须自行安全备份——丢失即无法解密。

## 用法

```bash
bash scripts/sync-memory.sh init     # 首次：生成密钥 + 公钥 + 默认清单
# 编辑 sync/manifest.txt 增删要同步的会话
bash scripts/sync-memory.sh push     # 加密写 sync/memory.tar.age
git add sync/ && git commit -m 'chore(sync): 更新加密记忆/会话' && git push

bash scripts/sync-memory.sh status   # 私钥/公钥指纹/密文状态（含 key fingerprint）
bash scripts/sync-memory.sh verify   # 校验：可解密 + 公钥与私钥一致 + 清单一致 + JSON 有效
bash scripts/sync-memory.sh verify --no-key   # 无私钥时只查密文完整性

# 新设备：
git pull
# 放置私钥到 ~/.config/my-pi/age.key（或设 MY_PI_AGE_KEY）
bash scripts/sync-memory.sh pull
```

`verify` 会区分「本地不存在（push 会跳过）」与「本地存在但密文里缺失」——后者说明备份过期，需重新 `push`。

## 注意

- 依赖 `age`（Debian/Ubuntu `apt install age`；Termux `pkg install age`）。
- 环境变量：`MY_PI_AGE_KEY`（私钥路径）、`MY_PI_SYNC_DIR`（覆盖 `sync/` 目录，便于在别处演练）。
- `pull` 会覆盖清单内文件，覆盖前自动备份到 `sync/.local-backup-*.tgz`。
- 会话目录按 cwd 转义命名（`portable/agent/sessions/<转义 cwd>/`），跨设备路径不同会错位；
  建议保持相同项目路径或使用 `--session-dir`。
- 与 roleplay 模式配合：其隔离记忆在 `portable/memory/roleplay/`，可在清单中单独选择是否同步。

## 相关

- 私钥如何在新设备上重建（引导包是否可行、哪些该放哪些不该放）：[docs/operations/KEY-BOOTSTRAP-ANALYSIS.md](../docs/operations/KEY-BOOTSTRAP-ANALYSIS.md)

## 引导包（方案 A）：新设备如何拿到 age 私钥

**只装解密材料**：`sync/bootstrap.age` = `age.key` + 一页说明，用 `age -p`（口令）加密；
元信息 `sync/bootstrap.meta.json`（明文、不含秘密：成员清单 / sha256 / 指纹 / 生成时间）。

```bash
# 有私钥的设备（如 PC worker）：
bash scripts/bootstrap-key.sh pack          # 口令输两遍 → sync/bootstrap.age + .meta.json
git add sync/bootstrap.age sync/bootstrap.meta.json && git commit -m 'chore(sync): 更新私钥引导包'

# 新设备（先 clone，再解包）：
ssh-keygen -t ed25519 -C "new-device"       # 生成新 key，用网页 + 2FA 添加公钥（不要搬运旧私钥）
bash scripts/bootstrap-key.sh unpack --yes  # 输口令 → ~/.config/my-pi/age.key（600，旧文件留 .bak）
bash scripts/bootstrap-key.sh verify        # 成员白名单 + 指纹是否与 sync/age.pub 一致
bash scripts/sync-memory.sh verify && bash scripts/sync-memory.sh pull
```

规则（重要）：

1. **口令**：≥6 词 diceware（≈77 bit）或密码管理器生成的 20+ 随机字符；**不复用**其它口令。
   忘记口令 = 记忆不可解（与"丢私钥"等价，只是载体从设备变成口令）→ 口令存密码管理器 + 纸质备份。
2. **不放 SSH 私钥**（也不放 `auth.json`/`deviceId`）：引导包成员被脚本限定为白名单两项，
   夹带其它文件（例如 `id_ed25519`）时 `verify`/`unpack` 会直接拒绝。
3. **轮换流程**：`age-keygen -o newkey` → `bash scripts/sync-memory.sh init`（会重写 `sync/age.pub`；私钥已存在时不覆盖，
   需先移走旧文件）→ `push` 重加密 bundle → `bootstrap-key.sh pack --force` 刷新引导包 → **在新设备演练一次恢复** → 销毁旧私钥。
4. **演练**：引导包必须在干净环境里真跑过一次 `unpack → verify → pull`，否则等于没有备份。
5. **明文私钥不要留在共享存储**：`pack`/`verify`/`unpack` 都会扫描常见位置并告警（Android 共享存储属组
   `aid_everybody`，且 FUSE 会忽略部分权限位）。

分析与取舍（为何 SSH 私钥不搬运、三方案对比、风险清单）：[docs/operations/KEY-BOOTSTRAP-ANALYSIS.md](../docs/operations/KEY-BOOTSTRAP-ANALYSIS.md)。
