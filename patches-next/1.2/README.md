# patches-next/1.2 —— 上游 pi 1.2 版本的补丁（**切换时换入 `patches/`**）

> **不要把这里的东西直接放进 `patches/`** ✗ —— 门禁会立刻变红。
> `scripts/golden-tasks.sh` 的「6. 补丁状态」是 `for p in "$ROOT"/patches/*.patch`（**只 glob `patches/*.patch`**）
> ⇒ 本目录**不会被扫到** ✓，所以可以安全存放，但要**切换 vendor 时**才换入。

## 目标

| 项 | 值 |
|---|---|
| 上游目标 commit | **`6374c2baf432419ccb4541a99ce4958ecd03dae0`**（`upstream/main`，`v1.2.0-37-g6374c2baf`） |
| 本目录文件 | `002-local-pi-mods.patch`、`010-disable-share-bug.patch`（**1.2 版**） |
| 为什么只有两个 | 其余 9 个（003–009、011）**原样可用** ✓；**001 需要用 `git apply -3`**（三方合并）✓ |

## 已验证（实测 ✓）

- **11/11 全部可干净重放到 `6374c2baf`** ✓✓（含本目录两个 ✓）
- **`custom/` 类型检查 0 错误**（源码面等价：`paths` 指向 1.2 源码，非脚本的 dist 路径 ✓）
- 断链证据：`interactive-mode.ts` 里我们的 handler 在 `shareSession(`/`reportBug(` **之前**就 `return` ✓
  ⇒ **010 的功能在 1.2 下不需要扩展** ✓（`share`/`bug` 两条命令表项仍是必须删的 ✓）

## 生成法（可复现 ✓）

```bash
git clone --shared vendor/pi /tmp/pi-probe && cd /tmp/pi-probe
git checkout 6374c2baf
for p in /root/my-pi/patches/*.patch; do
  case "$p" in
    *001-branding*)        git apply -3 "$p" ;;   # ★ 001 必须 -3
    *002-local-pi-mods*)   : ;;                   # 用本目录的 1.2 版
    *010-disable-share-bug*) : ;;                 # 用本目录的 1.2 版
    *)                     git apply "$p" ;;
  esac
done
git apply /root/my-pi/patches-next/1.2/002-local-pi-mods.patch
git apply /root/my-pi/patches-next/1.2/010-disable-share-bug.patch
git status --short   # ⇒ 应无 UU（冲突）标记
```

**改动要点（两个补丁都只是"换上下文锚点"）**：
- **002**：上游把 `tsconfig.build.json` 的 `exclude` 简化了 ⇒ 只换 `-` 上下文行，**`+` 行仍追加 `src/custom`**（意图不变 ✓）；
- **010**：上游把 `share` 的描述改成 "Radius artifact or a GitHub gist" ⇒ 只换那一行 `-` 上下文，**仍删 `share`/`bug` 两行**（意图不变 ✓）。

## 切换时怎么换入

1. 确认同步已完成（`vendor/pi` 已在 `6374c2baf` 且 9 个原样补丁已应用 ✓）；
2. 用本目录两个文件**替换** `patches/002-local-pi-mods.patch` 与 `patches/010-disable-share-bug.patch`；
3. ★ **必须保留补丁内的字面自标记 `Patch (NNN-name):`** ✓（`check-patches-behavior` 依赖它 ✓）；
4. 跑 `bash scripts/golden-tasks.sh --fast`（「6. 补丁状态」应全绿 ✓）。

## 仍未核实（✗）

- `6374c2baf` 之外的**中间版本**未逐一验证（本目录只针对该 commit ✓）；
- 本目录两个补丁**只在 `/tmp` 试验场验证过** ✓ —— **未经"真实 vendor 切换"路径** ✓（那需要用户决定 ✓）。
