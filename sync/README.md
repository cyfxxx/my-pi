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
