# knowledge-fetch 包经验沉淀

> 证据导向，标注环境。未合并条目 ≥3 条或用户要求时合并进 SKILL.md 正文并清本文件。

## 2026-09-22（环境：termux-ubuntu, hostname=localhost）

### 1. knowledge-fetch.py 输出路径由 PI_KNOWLEDGE_DIR 决定，不是 logs/
- **现象**：脚本 stdout 写 `新增 72 条 -> logs/knowledge/2026-09-22.md`，但实际文件落在 `portable/memory/knowledge/2026-09-22.md`。
- **原因**：第 15 行 `KLOG = os.environ.get('PI_KNOWLEDGE_DIR') or os.path.join(ROOT, 'portable', 'memory', 'knowledge')`，默认已收敛到 portable/；stdout 的 `logs/knowledge/` 是硬编码文案，误导排查。
- **影响**：按 stdout 路径去 `ls` 会误判"抓取失败"。后续直接看 `portable/memory/knowledge/<date>.md`。

### 2. memory_search 的 BM25 语义召回弱，不适合做"疑似重复"判定
- **现象**：用 `searchEntriesWithScores(query=title)` 查重时，5 条新条目全部被误判为重复（score 12-21，命中的是标题完全无关的旧条目，如"扩展命令整合规范"）。
- **原因**：`searchEntriesWithScores` 是**语义召回**（query token 与 doc 的 title/tags/content 做包含匹配 + qualityScore 加权），query 越长、token 越稀有，score 反而越高，与"是否重复"无关。
- **结论**：查重应直接用 `storeEntry()` 内置的规则消解（标题完全匹配 / contentHash / jaccard>0.7 近似合并），不要额外调 search。SKILL.md 第 4 步「memory_search 查重后逐条 memory_store」表述有歧义，实际入库动作本身已含去重。
- **修复**：`scripts/knowledge-ingest.mjs` 已改为直接 `storeEntry`，按 `action === 'created'` 计数。

### 3. 入库脚本需 TS 加载器，import 路径应基于脚本位置解析
- **现象**：`await import('./custom/features/memory/logic.ts')` 报 `ERR_MODULE_NOT_FOUND: .../scripts/custom/...`。
- **原因**：ESM 相对路径以脚本所在目录（scripts/）为基准。
- **修复**：已改为 `pathToFileURL(join(ROOT, 'custom/features/memory/logic.ts'))`（ROOT 由 `import.meta.url` 解析），可移植；加载 TS 需 `--experimental-strip-types` 或 `scripts/dev.sh`。

### 4. storeEntry 返回值是 `{entries, action}`，需用返回的 entries 替换原数组
- **现象**：第一版用 `Object.assign(existing, res.entries)` 不生效（数组长度不变）。
- **原因**：`storeEntry` 内部 `saveEntries(entries)` 返回的是新数组引用，原数组不会被原地更新。
- **修复**：`existing.length = 0; existing.push(...res.entries)`。

### 5. 本机运行环境是 termux（PI_MEMORY_ENV 未设置时 detectEnvironment() 返回 termux）
- **现象**：`detectEnvironment()` 返回 `termux`（`/storage/emulated/0` 存在），与 SKILL.md「本机环境备注」一致。
- **影响**：记忆条目 environments 标记为 `termux`，跨设备（wsl2/macos）检索时会按 env 过滤。知识订阅条目标记为当前环境，如需全设备可见应显式传 `['all']` 或后续统一用 `'all'`。

### 待办
- [x] knowledge-ingest.mjs 的 import 路径改为基于 ROOT 解析（可移植性）
- [x] 知识订阅条目 environments 统一用 'all'（跨设备可见）
- [ ] stdout 文案 `logs/knowledge/` 与实际路径不符，可改为打印真实 KLOG 路径（属 knowledge-fetch.py）