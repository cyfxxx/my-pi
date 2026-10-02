---
name: books
description: 书籍知识库（本机索引 + 按需提取页 + 缓存复用）。用户要求"查书里某段内容""这个说法出自哪本书哪一页""核对原文"时使用；也可用于把一批书的目录建成索引。用法：python3 scripts/books.py {probe|index|read|report}。不适用：纯网络资料（用 web_search/fetch_url）、需要整本精读（先 read 小段页码再判断要不要继续）。
version: v0.1
更新日期: 2026-10-02
---

# books 技能：书籍知识库

把"收藏的书"变成**可检索、可按页深读、可核对来源**的知识库。核心原则（`docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md`）：

> **目录优先建索引 → 按需只提需要的少数页 → 提取结果缓存复用 → 原文为准、答案带页码引用。**

## 何时用

- 用户问"某本书里怎么说的""这个结论出自哪本书哪一页""帮我核对原文"。
- 需要跨书找同一主题（先 `read` 各书的目录章节表，再定点提页）。
- 新书入库：`probe` → `index`（**不要**对整本书做 OCR，见"预算"）。

## 三步流程

```bash
# 1) 体检（只读，秒级）：每本书的页数/目录条数/是否有文字层/建议策略
python3 scripts/books.py probe --root "<书库根>"

# 2) 建索引（目录优先，零 OCR）：PDF outline / EPUB nav → 章节表
python3 scripts/books.py index

# 3) 按需提页（缓存优先，命中则不重复 OCR）
python3 scripts/books.py read --book 技术史-第1卷 --pages 120-123
python3 scripts/books.py report          # 汇总：书籍数/策略分布/已建索引/已缓存
```

`--book` 接受 book_id 或书名片段（全角符号/空格会归一化）。`--json` 可机读，`--dry-run` 只打印。

## 预算与限制（重要）

- **单次最多 8 页**（`page_budget`，`--force` 可覆盖）。本机 OCR 实测 **31–69 秒/页**（CPU/tesseract），所以"多提几页"很贵。
- 提页顺序：**文字层优先**（毫秒级）→ 无文字层才 OCR。同一页第二次直接命中缓存。
- **不要**对整本书跑提取；也不要为了"看看有没有用"批量提页。先用 `index` 的章节表定位。
- 本机语言包只有 `chi_sim/eng`；**古籍/竖排/繁体**（无 `chi_tra`）不要在本机硬跑，标 `needs_vision` 交给 PC 端（3070 Ti/32G，可接 PaddleOCR-GPU 或云端视觉）。

## 质量门与降级

每页提取后算 `chars` 与 `cjk_ratio`：不过门（默认 ≥120 字符、CJK 占比 ≥0.25）的页记进
`meta.jsonl` 的 `needs_vision`。此时**不要**直接把结果当真：改用云端多模态、或到 PC 端重跑、
或只做目录级索引后人工深读。

## 引用格式（必须遵守）

答案里给出来源，便于人工核对：`[《技术史·第1卷》第5章 p.120]`，并附本地绝对路径。
提取文本以 `----- p<页> (<method>) -----` 分段，`method ∈ {text, ocr, epub, direct}`。

## 数据与记录（都在运行时目录，不入库）

```
portable/memory/knowledge/books/
  _probe.jsonl          每本书一行：探测结果 + 建议策略（两端可核对）
  _report.md            人读汇总
  _needs_toc_ocr.jsonl  当前仍需目录页 OCR 的书（状态文件，每次覆盖）
  index/<book_id>.jsonl 章节表（不进上下文；book_id = 标题slug + 内容指纹8位）
  cache/<book_id>/…     提取文本 + meta.jsonl（method/quality/sha256/pages）
  logs/run-YYYYMMDD.jsonl  每次运行记录（命令/角色/设备/参数/计数/耗时）
```

`book_id` 由**文件内容指纹**决定（size + 首尾各 1 MB 的 sha1）→ 同一本书在两台设备上 id 相同，
缓存可同步（走 `scripts/sync-memory.sh` 的 age 加密通道），不必复制原始书。

## 两端分工

| 端 | 角色 | 做什么 |
|---|---|---|
| 手机（本机） | `phone` | 索引 + 按需提页（文字层优先）+ 小规模 OCR + 与 Agent 交互 |
| PC（3070 Ti/32G） | `worker` | 完整书库、批量目录页 OCR、GPU OCR/PaddleOCR、本地多模态兜底；结果回传缓存 |

配置：`portable/memory/books/config.json`（运行时，不入库）；模板 `packs/books/config.example.json`。
`probe/index --root` 会自动把书库根写进运行时配置，之后命令免重复指定。

## 隐私

书卡片与元信息带 `privacy_level`；标为敏感的书籍**禁止**任何云端调用（`privacy_cloud_vision` 只是开关，
真正的门是脚本里的隐私判断 + 你的判断）。个人使用也不要把提取内容公开分发。
