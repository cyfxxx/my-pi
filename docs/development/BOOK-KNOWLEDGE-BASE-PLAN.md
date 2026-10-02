# 书籍知识库方案（按 my-pi 现状优化）

> 输入：`/storage/emulated/0/Documents/书籍知识库.md`（用户构想 + 一份通用方案）。
> 本文只保留通用方案的正确内核（**轻量索引 → 按需深读 → 缓存复用**），把技术选型重写到
> **本机实测能力 + my-pi 已有组件**上，并补齐通用方案缺失的"按当前项目情况"的关键约束。

## 0. 结论摘要：与原方案的关键差异

| 维度 | 通用方案 | 本方案（按现状） | 依据 |
|---|---|---|---|
| 索引存储 | SQLite/PostgreSQL + 向量库（Chroma/FAISS） | **`portable/memory/`**：每本书 1 条记忆条目（L1 卡片）+ 每本书 1 个 `index.jsonl`（章节表，**不进上下文**） | my-pi 已有条目治理（confidence/recurrence/links/supersededBy）+ BM25/jaccard 检索；新 DB 会重复造轮子 |
| 检索 | 向量 + BM25 混合 | **先用现有 BM25/jaccard（零新依赖）**；向量仅在"检索质量被证伪"后再评估 | 无 numpy/无向量库；注入预算 500 token 级，语义检索收益需实测 |
| 全文 OCR | GPU 2–5 页/秒，全量预处理 ≈35–80 小时 | **禁止全量 OCR**：本机实测 **31–69 秒/页**（CPU/tesseract 5.3.4）→ 1.5 GB 试点全量要约 100+ 小时，200 GB 规模不可能 | 见 §1.3 实测 |
| 索引来源 | 目录 OCR + 小模型生成摘要 | **目录优先**：实测 23/36 本有内嵌 outline → 零 OCR 建索引；摘要只在需要时用便宜模型补 | 见 §1.2 |
| Agent 集成 | 新增 7 个工具（search_index/load_pages/ocr_page…） | **脚本 + 技能**（`packs/books/SKILL.md`），走内置 `bash`；**不新增工具** | 工具占 tools 前缀（实测 62 工具 28.5 KB）；这批能力低频、无状态、文件进出，正好符合"适合外置"判据（见 `TOOL-EXTERNALIZATION-ANALYSIS.md`） |
| 框架 | LangChain/LlamaIndex | 不引入；编排用 `bash` + headless 定时任务 + `tmux` | 项目既有形态 |
| 数据位置 | 假设 200 GB 在本机 | **书在别处**（本机共 105 GB、可用 51 GB，实测书库仅 1.5 GB）→ 本机只存索引与文本缓存，重活交给有书的机器 | 见 §1.1 |
| 来源可信 | 记录来源字段 | 复用 memory 的 `source`/`observedAt`/`links` + **原文为准**（摘要永不覆盖原文），答案强制带引用 | VISION §3.3/§3.4 |

## 1. 实测事实（2026-10-01，本机）

### 1.1 环境与容量
- CPU 6 核；内存 7.5 GB（**可用仅 ~1.4 GB**）；磁盘 105 GB（**可用 51 GB**）。
- 已达的可达书库：`/storage/emulated/0/我的文件/书籍` = **40 个文件 / 1.54 GB**（36 PDF + 4 EPUB）。
  用户所述"约 200 GB"的书不在本机（无外置存储挂载）→ 方案必须**路径可配置、缓存可同步、支持两端分工**。
- 工具：`pdftotext/pdfinfo/pdftoppm`（poppler）、`tesseract 5.3.4`（语言包 **只有 chi_sim/eng/osd，无 chi_tra**）、
  `unzip`、`python3.12`；**缺** `mutool`、`ocrmypdf`、`calibre`、`7z`。
- Python：**有** `pymupdf(fitz)`、`pdfplumber`、`pypdf`、`PIL`；**缺** `numpy`、`pytesseract`、`cv2`、`ebooklib`、`lxml`。
  → EPUB 无需 ebooklib：`zipfile` + `html.parser` 足够（少一个依赖就少一处 Termux 安装风险）。

### 1.2 书库构成（40 本抽样）
- **可用文字层（前 3 页 ≥200 字符）7 本；疑似需 OCR 29 本**（旧书/扫描件为主）。
- **有内嵌 outline 目录 23 本**（技术史 8 卷、军事/医学/化学自学丛书、毒物简史…），条数 12–443。
- 4 本 EPUB 全部带 nav/ncx。
- 结论：**索引层基本可以零 OCR 建成**；OCR 只用于"无 outline 的书"的目录页（每本几页）与正文按需页。

### 1.3 OCR 真实速度与质量（200 dpi 灰度 + `tesseract -l chi_sim+eng --psm 6`）
| 书/页 | 渲染 | OCR | 输出 | 质量 |
|---|---|---|---|---|
| 技术史·第1卷 p120 | 0.33 s | **69.1 s** | 1 929 字符 / 1 312 汉字 | 可用（少量噪声） |
| 法医毒物学手册 p300 | 0.10 s | **33.6 s** | 1 017 字符 / 395 汉字 | 部分可用 |
| 新赤脚医生手册 p200 | 0.22 s | **31.0 s** | 898 字符 / 258 汉字 | 差（该页为插图） |

→ 与本机能力对比，**"全量 OCR"在数量级上不成立**；OCR 必须由"用户问题"驱动，且每次只处理极少数页。

## 2. 三层落点（复用 my-pi 既有组件）

```
L1 索引层（进上下文，极小）   每本书 1 条记忆条目（卡片）+ 每本书 1 个 index.jsonl（章节表，不进上下文）
L2 提取层（按需，落盘复用）   portable/memory/knowledge/books/<book_id>/p<start>-<end>.txt + meta.json
L3 沉淀层（跨书复用）         记忆条目（category=reference/fact），source 指回 L2，走既有生命周期治理
```

| 层 | 落点 | 现成能力 | 新增量 |
|---|---|---|---|
| L1 卡片 | `entries.json`（`category=reference`，`tags=['book',<主题>]`，`environments` 控制可见模式） | `memory_store`/`/memory search`、BM25+qualityScore+MMR 召回、append-only 尾部注入、500 token 预算、`supersededBy`/垃圾/升格治理 | 仅约定字段与生成脚本 |
| L1 章节表 | `knowledge/books/<id>/index.jsonl`（`chapter/toc_path/page_start/page_end/source`） | `scripts/knowledge-*.mjs` 的目录约定 | 生成/检索脚本 |
| L2 文本 | `knowledge/books/<id>/p0001-0008.txt` + `meta.json`（`method/confidence/sha256/pages/tool/ts`） | `knowledge/` 目录、age 加密同步 `sync-memory.sh` | 提取脚本 |
| L3 卡片 | `entries.json`（`source='《书》p245'`、`links=[book_id]`） | 去重（contentHash）、矛盾/取代、recurrence 升格 | 生成脚本 + 引用规范 |
| 批量 | headless 定时任务（`--no-extensions`，只用 bash/read/write + scripts） | `scheduled-seeds.json` + `seed`/`daily-review` 机制、`tmux` + watcher 通知、`resume` 游标 | 新的 seed/脚本 |

## 3. 数据契约

**L1 卡片（一条记忆条目）**——控制在 ~200 字符，因为它每一轮都会被注入计价：
```json
{ "category": "reference", "title": "《技术史·第1卷》", "content": "远古至古代帝国衰落；含史前技术、农业起源、冶金；适合查'技术演进时间线'类问题。路径: 我的文件/书籍/技术史系列丛书/…pdf",
  "tags": ["book","技术史","工具书"], "confidence": 0.9, "source": "books-index:sha1(文件)", "environments": ["all"] }
```
**L1 章节表（`index.jsonl`，每章一行，永不进上下文）**：
```json
{ "book_id": "tech-history-v1", "chapter": "第5章 原始计时", "toc_path": "第5章/5.2 日晷", "page_start": 118, "page_end": 133,
  "summary": null, "keywords": ["计时","日晷"], "source": "outline", "confidence": 1.0 }
```
**L2 `meta.json`**：`book_id/page_start/page_end/method(text|ocr|vision)/tool/tool_version/dpi/sha256_source/created_at/confidence/cjk_ratio`
**引用格式**（Agent 输出强制）：`[《技术史·第1卷》第5章 p.120]`，并给出本地绝对路径便于人工核对。

## 4. 关键设计决策（8 条）

1. **目录优先，OCR 兜底**：先 `get_toc()`/EPUB nav → 23/36 本书零成本建索引；无 outline 才 OCR 目录页（每本 ≤20 页，约 10 分钟）。
2. **页面预算**：单次提问最多提取 **8 页**（可配 `PI_BOOKS_PAGE_BUDGET`），先查 L2 缓存，未命中才提取；同一页永不重复 OCR。
3. **缓存即资产**：L2 是唯一会随使用增值的数据 → 纳入 `sync-memory.sh` 加密同步与备份；原始书文件不入库、不复制。
4. **原文为准**：`raw_text` 只由提取工具写入；模型摘要另存（`summary` 字段或独立条目）并标 `source`，**禁止覆盖原文**（防幻觉污染，VISION §3.4）。
5. **脚本 + 技能，不加工具**：`packs/books/SKILL.md`（零系统提示词成本）+ 三个脚本；避免 tools 前缀膨胀，且不受"会话中途不能改工具集"限制。
6. **注入受预算约束**：书卡片走既有 memory 召回（500 token 预算、内容截断 80 token），**章节表不注入**；
   按 `environments`/命名空间控制"哪个模式能看到哪类书架"（如角色扮演模式不加载技术书卡）。
7. **隐私门**：书卡片带 `privacy_level`；标记为敏感的书籍，脚本**拒绝**任何云端调用（本地 tesseract/或 PC worker）。
8. **可核对**：答案引用到"书 + 章节 + 页码"，L2 保留 `sha256` 与来源路径；抽取结果附带 `cjk_ratio` 与长度做质量门。

## 5. 成本与工时模型（用量级说话）

| 策略 | 一次性成本 | 每问成本 |
|---|---|---|
| 全量 OCR（原方案默认） | 1.5 GB 试点 ≈ **100+ 小时** CPU；200 GB ≈ **>1 万小时** | 0 |
| **本方案（目录优先 + 按需 8 页 + 缓存）** | 建索引：23 本零 OCR + 13 本目录页 OCR ≈ **2–4 小时**（后台） | 命中缓存 0；未命中 ≤8 页 ≈ **4–9 分钟**本地，或 1–2 次云端视觉调用 |
| 只有文字层的现代 PDF/EPUB | 直接抽文本，秒级 | 0 |

**哪些书值得 OCR**：`有文字层` → 直接抽；`有 outline 无文字层` → 索引免 OCR、正文按需 OCR（本方案主路径）；
`无 outline 无文字层` → 先 OCR 目录页建索引，正文按需；`古籍/竖排/异体字` → 本机 tesseract 不适用
（无 `chi_tra`、无竖排模型）→ 标记 `needs_vision`，走云端视觉或 PC worker，或**只做目录级索引 + 人工深读**。

## 6. 分期路线（每阶段都有可验证判据）

- **P0 只读体检（0.5 天）**：`scripts/books-probe.mjs` 输出"每本书：页数/文字层/outline/体积/是否疑似扫描/建议策略"，
  落 `knowledge/books/_probe.jsonl`。判据：40 本全部产出建议策略，且与本文 §1.2 数字一致。
- **P1 索引层（1–2 天）**：`scripts/books-index.mjs`（outline → `index.jsonl`；无 outline 走目录页 OCR）+ 每本书 1 条 L1 卡片入库。
  判据：≥80% 的书生成章节表；`/memory search "技术史 冶金"` 能召回对应书卡；注入增量 <2 KB。
- **P2 按需提取（1–2 天）**：`scripts/books-read.mjs --book <id> --pages 118-125`（缓存优先、质量门、写 L2 meta）+ `packs/books/SKILL.md`。
  判据：同一问题第二次提问 100% 命中缓存；单页 OCR 结果通过 `cjk_ratio` 门或标记 `needs_vision`。
- **P3 规模化与沉淀（持续）**：headless seed 批量补索引（断点续跑、限速）；L3 卡片由"被反复用到的 L2 片段"提炼
  （复用 memory 的 recurrence≥5 升格通道）。判据：批量任务可中断可续跑；L3 卡片都带 `source` 且能回指到页。

## 7. 风险与降级

| 风险 | 降级 |
|---|---|
| 本机 OCR 慢/质量差 | 只按需页 + 缓存；质量门失败标 `needs_vision`；把 OCR 挪到 PC worker（同一套脚本） |
| 内存仅 ~1.4 GB 可用 | 逐页渲染（不整本载入）；`pymupdf` 单页 pixmap；避免 numpy/大模型本地推理 |
| 磁盘仅 51 GB 可用 | L2 只存文本（KB 级/页）；不缓存页面图像；原始书不入库 |
| 书库不在本机 | 索引与缓存可同步（`sync-memory.sh`）；按需拉单本，或全部在 PC 端跑同脚本 |
| 古籍竖排/繁体 | 本机不承接，标 `needs_vision`；或只做目录级索引 |
| 模型幻觉 | 原文为准 + 强制引用 + 人工可核对（sha256/页码） |
| 版权 | 仅个人使用；L2 缓存不入公开仓库（`portable/` 已在 .gitignore 语义内） |

## 8. 需要你确认/提供的（其余我已按现状定好）

1. **书库根路径**（本机 `/storage/emulated/0/我的文件/书籍` 只是 1.5 GB 的一部分；200 GB 那份在哪？外置盘/PC/网盘？）
2. **是否有可跑 worker 的机器**（PC/NAS，含 CPU 与书的物理位置）——决定 OCR 放哪一端。
3. **云端视觉兜底**是否允许，以及**每页/每月预算上限**（古籍与图版页几乎只能用这个）。
4. **古籍清单与质量标准**（哪些书必须人工校对才可用）。
5. **备份位置**（L2 缓存是长期资产：走现有 age 加密同步，还是另指定目录）。

> 上述 5 项不影响 P0（只读体检）；P1 起需要第 1 项，OCR 分流需要第 2、3 项。
