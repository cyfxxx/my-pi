#!/usr/bin/env python3
"""
books.py — 书籍知识库框架（探针 / 索引 / 按需提取 / 报告 / 自检）

设计目标（见 docs/development/BOOK-KNOWLEDGE-BASE-PLAN.md）：
  · 同一套脚本在**两端通用**：本机（手机/代理端）与 PC（3070 Ti + 32G，重活端）；
  · **目录优先**：有内嵌 outline/nav 的书零 OCR 建索引；OCR 只发生在"问题驱动的少数页"；
  · **缓存即资产**：提取结果按页范围落盘复用，命中则不重复 OCR；
  · **记录优先**：每次运行追加 run log，探测结果落 _probe.jsonl，便于跨设备核对与续跑；
  · 无第三方依赖（除 PDF 解析用 PyMuPDF）；EPUB 用标准库 zipfile 解析。

用法：
  python3 scripts/books.py <probe|index|read|report|selftest> [选项]
  python3 scripts/books.py probe  --root "/path/to/books" --limit 5 --json
  python3 scripts/books.py index  --root "/path/to/books"
  python3 scripts/books.py read   --book <book_id> --pages 120-127
  python3 scripts/books.py report

记录布局（默认 `portable/memory/knowledge/books/`，可 --out 覆盖；运行时数据、不入库）：
  _probe.jsonl                     每本书一行：探测结果 + 建议策略
  _report.md                       人读汇总
  index/<book_id>.jsonl            章节表（不进上下文）
  cache/<book_id>/p<start>-<end>.txt   提取文本
  cache/<book_id>/meta.jsonl       每段提取的元信息（method/quality/sha256/来源）
  logs/run-YYYYMMDD.jsonl          每次运行记录
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

# ── 常量与默认值 ────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "portable" / "memory" / "knowledge" / "books"
DEFAULT_RUNTIME_CONFIG = REPO_ROOT / "portable" / "memory" / "books" / "config.json"
EXAMPLE_CONFIG = REPO_ROOT / "packs" / "books" / "config.example.json"

DEFAULTS = {
    "role": "phone",                      # phone | worker
    "library_roots": [],
    "text_layer_sample_pages": 6,
    "text_layer_min_chars": 200,
    "toc_page_range": [1, 20],
    "page_budget": 8,
    "dpi": 200,
    # rapidocr：onnxruntime + PaddleOCR 模型，模型随 wheel 分发（离线可用），
    # 本机实测 3-5 秒/页（12 本各 12 页的抽样：426 s / 144 页）；
    # tesseract 在本机 31-69 秒/页，慢一个数量级。
    "ocr_engine": "rapidocr",
    "ocr_langs": "chi_sim+eng",   # 仅 tesseract 用
    "ocr_psm": "6",               # 仅 tesseract 用
    "quality_min_chars": 120,
    "quality_min_cjk_ratio": 0.25,
    "privacy_cloud_vision": False,
}

BOOK_EXTS = {".pdf", ".epub", ".txt", ".md", ".docx", ".mobi", ".azw3", ".djvu", ".cp2", ".c2"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _init_console() -> None:
    """让 stdout/stderr 能吃下 ✓/❌/·/→ 这类符号。

    实测（Windows 11 + 中文区域）：控制台默认 GBK，脚本里 15 行输出含 ✓/❌，
    `print` 直接 `UnicodeEncodeError: 'gbk' codec can't encode character '\u2713'`
    —— 连 `selftest` 都会崩在打印阶段，而不是崩在真正失败的检查上。
    优先 reconfigure 成 UTF-8；不支持则退化为 errors='replace'（宁可显示成 ? 也不崩）。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError, OSError):
            try:
                stream.reconfigure(errors="replace")  # type: ignore[union-attr]
            except (AttributeError, ValueError, OSError):
                pass


_init_console()


def hostname() -> str:
    """跨平台取主机名。

    `os.uname()` 是 POSIX-only —— Windows 上根本没有这个函数（实测
    `AttributeError: module 'os' has no attribute 'uname'`），而本脚本有三处用它
    写"设备/主机"字段（run log、探测记录、报告头），于是整条 selftest 会崩在收尾。
    """
    try:
        return os.uname().nodename
    except AttributeError:
        return os.environ.get("COMPUTERNAME") or os.environ.get("HOSTNAME") or "unknown"


def log(msg: str) -> None:
    print(msg, flush=True)


# ── 配置 ────────────────────────────────────────────────────────────────────


def load_config(explicit: str | None) -> dict:
    cfg = dict(DEFAULTS)
    for path in [EXAMPLE_CONFIG, DEFAULT_RUNTIME_CONFIG]:
        if path.exists():
            try:
                cfg.update(json.loads(path.read_text(encoding="utf-8")))
            except Exception as exc:  # 配置损坏不阻塞，回退默认
                log(f"[warn] 配置读取失败 {path}: {exc}")
    if explicit:
        p = Path(explicit)
        if p.exists():
            cfg.update(json.loads(p.read_text(encoding="utf-8")))
        else:
            raise SystemExit(f"配置文件不存在: {p}")
    # 环境变量覆盖（两端部署常用）
    if os.environ.get("PI_BOOKS_ROLE"):
        cfg["role"] = os.environ["PI_BOOKS_ROLE"]
    if os.environ.get("PI_BOOKS_ROOTS"):
        cfg["library_roots"] = [x for x in os.environ["PI_BOOKS_ROOTS"].split(os.pathsep) if x]
    if os.environ.get("PI_BOOKS_PAGE_BUDGET"):
        cfg["page_budget"] = int(os.environ["PI_BOOKS_PAGE_BUDGET"])
    if os.environ.get("PI_BOOKS_DPI"):
        cfg["dpi"] = int(os.environ["PI_BOOKS_DPI"])
    if os.environ.get("PI_BOOKS_OCR_ENGINE"):
        cfg["ocr_engine"] = os.environ["PI_BOOKS_OCR_ENGINE"]
    if os.environ.get("PI_BOOKS_OCR_LANGS"):
        cfg["ocr_langs"] = os.environ["PI_BOOKS_OCR_LANGS"]
    return cfg


# ── 记录（run log / probe / meta） ──────────────────────────────────────────


def runtime_config_path() -> Path:
    """运行时配置路径（可用 `PI_BOOKS_RUNTIME_CONFIG` 覆盖）。

    为什么需要覆盖（2026-10-13 实测缺陷）：`cmd_probe` 会无条件 `persist_roots`，
    而它写的是**模块级常量**指向的全局配置文件。于是 `selftest` 把自己的**临时书库根**
    写进了真实用户配置 —— 实测把 `library_roots` 冲成了
    `D:\\Desktop\\Temp\\my-pi-books-selftest-xxx\\library`（该目录随后即被删除）。
    `--out` 只覆盖记录目录，管不到这里，所以自检无法隔离。加此覆盖位后，
    自检把持久化重定向到自己的临时目录，不再污染真实配置。
    """
    override = os.environ.get("PI_BOOKS_RUNTIME_CONFIG")
    return Path(override) if override else DEFAULT_RUNTIME_CONFIG


_GUARDED_ROOTS: list[Path] = []


def guard_library_roots(roots: list[Path]) -> None:
    """登记"书库根"，之后所有写入都会避开这些目录。

    **绝对限制（用户 2026-10-13 明确要求）：绝不破坏书籍源文件。** 本函数是该限制的落点 ——
    不是在文档里写一句"请勿修改"，而是让"写到书库"在代码上**不可能发生**（VISION §3.1：
    反复有效的软引导必须硬化）。

    为什么需要它：本工具对书库**只读**（`pymupdf.open()` 默认只读、`open("rb")`），
    所有写入都指向 `out/`、缓存、运行配置与临时目录 —— 但这只是**现状**，原先没有任何
    机制阻止误配。实测风险：把 `--out` 指到书库内（例如 `--out 'M:/文件'`），
    `index/`、`_report.md`、`cache/` 就会写进书籍所在目录。

    判定用 `Path.resolve()` 后的**前缀包含**，因此 `..` 穿越与相对路径都挡得住；
    等于书库根本身、或其子路径，都拒绝。
    """
    _GUARDED_ROOTS[:] = [Path(r).resolve() for r in roots]


def _inside_library(target: Path) -> Path | None:
    """target 若落在任一已登记书库根内，返回该根；否则 None。"""
    try:
        t = Path(target).resolve()
    except OSError:
        return None
    for root in _GUARDED_ROOTS:
        if t == root or root in t.parents:
            return root
    return None


def safe_write(target: Path, *, what: str) -> None:
    """写入前守门：目标落在书库内则**拒绝并终止**，绝不静默跳过。

    故意 `raise SystemExit` 而不是"改成写到别处"：静默改道会让用户以为产物在
    `--out` 指定处，实际不知去向；显式失败才是可诊断的（与工具其它错误的处理一致）。
    """
    hit = _inside_library(target)
    if hit is not None:
        raise SystemExit(
            f"拒绝写入：{what} 目标落在书库根内 —— 这会破坏书籍源文件（绝对限制）。\n"
            f"  目标   : {target}\n"
            f"  书库根 : {hit}\n"
            f"  处理   : 把 --out / 缓存目录 / 配置文件指到书库**之外**（默认值即是如此）。"
        )


def guard_mkdir(target: Path, *, what: str) -> None:
    """建目录前守门（同 `safe_write`：书库内一律拒绝）。"""
    safe_write(target, what=what)


def persist_roots(roots: list[Path], dry_run: bool) -> None:
    """把本次使用的书库根写进运行时配置（portable/memory/books/config.json），后续命令免重复 --root。"""
    if dry_run or not roots:
        return
    cfg_path = runtime_config_path()
    safe_write(cfg_path, what="运行时配置")
    cur = {}
    if cfg_path.exists():
        try:
            cur = json.loads(cfg_path.read_text(encoding="utf-8"))
        except Exception:
            cur = {}
    merged = [str(r) for r in roots]
    old = list(cur.get("library_roots", []))
    if old != merged:
        cur["library_roots"] = merged
        guard_mkdir(cfg_path.parent, what="运行时配置目录")
        cfg_path.write_text(json.dumps(cur, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def append_jsonl(path: Path, record: dict, dry_run: bool = False) -> None:
    if dry_run:
        return
    safe_write(path, what="记录文件")
    guard_mkdir(path.parent, what="记录目录")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


class RunRecorder:
    """每次运行留一条记录：命令/角色/设备/参数/计数/耗时。"""

    def __init__(self, out: Path, cmd: str, cfg: dict, argv: list[str], dry_run: bool):
        self.out, self.cmd, self.cfg, self.argv, self.dry_run = out, cmd, cfg, argv, dry_run
        self.t0 = time.time()
        self.counts: dict[str, int] = {}

    def bump(self, key: str, n: int = 1) -> None:
        self.counts[key] = self.counts.get(key, 0) + n

    def finish(self, **extra) -> dict:
        rec = {
            "ts": now_iso(),
            "cmd": self.cmd,
            "role": self.cfg.get("role"),
            "host": hostname(),
            "argv": self.argv,
            "counts": self.counts,
            "elapsed_ms": int((time.time() - self.t0) * 1000),
            **extra,
        }
        append_jsonl(self.out / "logs" / f"run-{datetime.now().strftime('%Y%m%d')}.jsonl", rec, self.dry_run)
        return rec


# ── book_id：跨设备稳定的内容指纹 ───────────────────────────────────────────


def slugify(name: str, max_len: int = 40) -> str:
    base = re.sub(r"[^\w\u4e00-\u9fff]+", "-", name).strip("-")
    return (base[:max_len] or "book").lower()


def content_fingerprint(path: Path, probe_bytes: int = 1 << 20) -> str:
    """size + 首尾各 1MB 的 sha1 → 同一文件在两端得到同一 id（缓存可同步）。"""
    size = path.stat().st_size
    h = hashlib.sha1()
    h.update(str(size).encode())
    with path.open("rb") as fh:
        h.update(fh.read(probe_bytes))
        if size > probe_bytes * 2:
            fh.seek(-probe_bytes, os.SEEK_END)
            h.update(fh.read(probe_bytes))
    return h.hexdigest()[:8]


def make_book_id(path: Path) -> str:
    return f"{slugify(path.stem)}-{content_fingerprint(path)}"


# ── PDF / EPUB 基础读取 ────────────────────────────────────────────────────


class MissingPdfLib(RuntimeError):
    """PDF 解析库缺失（PyMuPDF）。selftest 据此**优雅跳过**而非抛栈：
    缺它只影响 PDF 相关自检，不影响其它子命令。安装：python3 -m pip install pymupdf
    （依赖声明见 scripts/README.md 的"外部依赖"节）"""


def pymupdf():
    try:
        import pymupdf  # type: ignore

        return pymupdf
    except ImportError:
        try:
            import fitz  # type: ignore

            return fitz
        except ImportError as exc:
            raise MissingPdfLib("缺少 PyMuPDF；安装：python3 -m pip install pymupdf") from exc


def pdf_probe(path: Path, cfg: dict) -> dict:
    mupdf = pymupdf()
    doc = mupdf.open(str(path))
    try:
        pages = doc.page_count
        toc = doc.get_toc() or []
        sample = sample_pages(pages, int(cfg["text_layer_sample_pages"]))
        chars = 0
        for pno in sample:
            chars += len((doc[pno - 1].get_text() or "").strip())
        avg = chars / max(1, len(sample))
        text_ok = avg >= float(cfg["text_layer_min_chars"])
        has_toc = len(toc) > 0
        if has_toc and text_ok:
            strategy = "text_direct"                      # 目录 + 文字层：最省
        elif has_toc:
            strategy = "outline_index_then_ondemand_ocr"  # 目录免费，正文按需 OCR
        elif text_ok:
            strategy = "text_direct_needs_toc"            # 文字层可用但无目录
        else:
            strategy = "needs_toc_ocr"                    # 都要 OCR（先目录页）
        return {
            "format": "pdf",
            "pages": pages,
            "outline_entries": len(toc),
            "sampled_pages": sample,
            "avg_chars_per_sampled_page": round(avg, 1),
            "text_layer": text_ok,
            "suspected_scan": not text_ok,
            "strategy": strategy,
        }
    finally:
        doc.close()


def sample_pages(pages: int, k: int) -> list[int]:
    if pages <= 0:
        return []
    k = max(1, min(k, pages))
    if pages <= k:
        return list(range(1, pages + 1))
    step = pages / k
    out = sorted({max(1, min(pages, int(1 + i * step))) for i in range(k)})
    return out


class _TextExtract(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(raw: str) -> str:
    parser = _TextExtract()
    try:
        parser.feed(raw)
    except Exception:
        pass
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()


def epub_entries(path: Path) -> tuple[list[str], int]:
    """返回 (xhtml/html 条目名列表, nav 条目数)。"""
    with zipfile.ZipFile(path) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith((".xhtml", ".html", ".htm"))]
        nav = [n for n in zf.namelist() if n.lower().endswith(".ncx") or "nav" in n.lower()]
    return names, len(nav)


def epub_probe(path: Path, cfg: dict) -> dict:
    names, nav = epub_entries(path)
    chars = 0
    with zipfile.ZipFile(path) as zf:
        for n in names[: int(cfg["text_layer_sample_pages"])]:
            chars += len(html_to_text(zf.read(n).decode("utf-8", "replace")))
    return {
        "format": "epub",
        "pages": len(names),           # EPUB 以"章节文件"近似页
        "outline_entries": nav,
        "avg_chars_per_sampled_page": round(chars / max(1, min(len(names), int(cfg["text_layer_sample_pages"]))), 1),
        "text_layer": chars > 0,
        "suspected_scan": False,
        "strategy": "epub_direct" if nav else "epub_direct_needs_nav",
    }


def probe_file(path: Path, cfg: dict) -> dict:
    rec = {
        "book_id": make_book_id(path),
        "path": str(path),
        "title": path.stem,
        "size_mb": round(path.stat().st_size / 1024 / 1024, 2),
        "mtime": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"),
        "privacy_level": "normal",
    }
    ext = path.suffix.lower()
    try:
        if ext == ".pdf":
            rec.update(pdf_probe(path, cfg))
        elif ext == ".epub":
            rec.update(epub_probe(path, cfg))
        elif ext in (".txt", ".md"):
            rec.update({"format": ext.lstrip("."), "strategy": "text_direct", "text_layer": True, "suspected_scan": False})
        elif ext == ".docx":
            rec.update({"format": "docx", "strategy": "needs_docx_dep", "text_layer": True, "suspected_scan": False})
        else:
            rec.update({"format": ext.lstrip(".") or "unknown", "strategy": "unsupported", "text_layer": False, "suspected_scan": True})
    except Exception as exc:
        rec.update({"format": ext.lstrip("."), "strategy": "error", "error": f"{type(exc).__name__}: {exc}"})
    return rec


# ── index：章节表 ──────────────────────────────────────────────────────────


def build_rows_from_toc(toc: list, pages: int) -> list[dict]:
    rows = []
    for i, entry in enumerate(toc):
        # PDF outline 标题里可能带 NUL/控制字符（实测某书卷首条目含 \x00）→ 清洗后再落盘
        level = int(entry[0])
        title = re.sub(r"[\x00-\x1f]+", " ", str(entry[1])).strip()
        page = int(entry[2])
        end = pages
        for nxt in toc[i + 1:]:
            if int(nxt[0]) <= level:
                end = max(page, int(nxt[2]) - 1)
                break
        rows.append({
            "chapter": title,
            "toc_path": title,
            "page_start": page,
            "page_end": end,
            "level": level,
            "source": "outline",
            "confidence": 1.0,
        })
    return rows


def epub_index_rows(path: Path) -> list[dict]:
    names, _ = epub_entries(path)
    rows = []
    with zipfile.ZipFile(path) as zf:
        for i, n in enumerate(names, start=1):
            try:
                title = html_to_text(zf.read(n).decode("utf-8", "replace"))[:60]
            except Exception:
                title = n
            rows.append({
                "chapter": title or n,
                "toc_path": n,
                "page_start": i,
                "page_end": i,
                "level": 1,
                "source": "epub_spine",
                "confidence": 0.7,
            })
    return rows


def cmd_index(args, cfg, rec: RunRecorder) -> dict:
    roots = resolve_roots(args, cfg)
    persist_roots(roots, args.dry_run)
    out = Path(args.out)
    made, skipped, flagged = 0, 0, []
    probes = {r["book_id"]: r for r in read_jsonl(out / "_probe.jsonl")}
    for path in iter_books(roots, args.limit):
        book_id = make_book_id(path)
        target = out / "index" / f"{book_id}.jsonl"
        if target.exists() and not args.force:
            skipped += 1
            rec.bump("skipped")
            continue
        info = probes.get(book_id) or probe_file(path, cfg)
        ext = path.suffix.lower()
        rows: list[dict] = []
        if ext == ".pdf" and info.get("outline_entries", 0) > 0:
            mupdf = pymupdf()
            doc = mupdf.open(str(path))
            try:
                rows = build_rows_from_toc(doc.get_toc() or [], doc.page_count)
            finally:
                doc.close()
        elif ext == ".epub":
            rows = epub_index_rows(path)
        if rows:
            if not args.dry_run:
                safe_write(target, what="章节表索引")
                guard_mkdir(target.parent, what="索引目录")
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("w", encoding="utf-8") as fh:
                    for row in rows:
                        fh.write(json.dumps({"book_id": book_id, **row}, ensure_ascii=False) + "\n")
            made += 1
            rec.bump("indexed")
            log(f"  ✓ 索引 {info.get('title', path.stem)}: {len(rows)} 章（{rows[0]['source']}）")
        else:
            flagged.append({"book_id": book_id, "title": path.stem, "reason": info.get("strategy"), "toc_page_range": cfg["toc_page_range"]})
            rec.bump("needs_toc_ocr")
            log(f"  - 需目录页 OCR：{path.stem}（策略 {info.get('strategy')}）")
    if not args.dry_run:
        # 这是"当前状态"文件（不是追加日志）：每次覆盖，便于两端核对哪些书还需要目录页 OCR
        target = out / "_needs_toc_ocr.jsonl"
        safe_write(target, what="需目录页 OCR 状态文件")
        guard_mkdir(target.parent, what="记录目录")
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8") as fh:
            for row in flagged:
                fh.write(json.dumps({**row, "recorded_at": now_iso()}, ensure_ascii=False) + "\n")
    return {"indexed": made, "skipped": skipped, "needs_toc_ocr": len(flagged)}


# ── read：按需提取（缓存优先） ─────────────────────────────────────────────


_RAPIDOCR_SINGLETON = None


def _rapidocr():
    """惰性加载 RapidOCR（onnxruntime）单例。

    为什么接它（2026-10-13 在本机实测）：
      · **tesseract 在本机 31–69 秒/页**（项目文档 §1.3 记录），516 本扫描书的目录页
        按每本 10–20 页算要 45–120 小时 —— 数量级上不可行；
      · **RapidOCR 实测 2.4–4.4 秒/页（约快 10 倍）**，且**模型随 wheel 分发**
        （`rapidocr_onnxruntime/models/*.onnx`，约 13 MB，无需联网下载），
        对本库的 1950 年代简体旧书可用。
      · 另一条现实约束：本机拿不到 tesseract 安装包（UB-Mannheim 403、GitHub 不通、
        无 winget/scoop/choco/conda），而 **PyPI 镜像通畅** —— RapidOCR 是唯一可装的路线。
    本函数保留 tesseract 作为回退，不破坏既有环境（`ocr_engine: "tesseract"` 仍可用）。
    """
    global _RAPIDOCR_SINGLETON
    if _RAPIDOCR_SINGLETON is None:
        try:
            from rapidocr_onnxruntime import RapidOCR  # type: ignore
        except ImportError as exc:  # pragma: no cover - 取决于环境
            raise RuntimeError(
                "OCR 引擎 rapidocr 不可用：缺 rapidocr_onnxruntime"
                "（安装：python3 -m pip install rapidocr-onnxruntime onnxruntime）"
            ) from exc
        _RAPIDOCR_SINGLETON = RapidOCR()
    return _RAPIDOCR_SINGLETON


def ocr_image(png: Path, cfg: dict) -> str:
    """对单页图片做 OCR，返回文本。引擎由 `ocr_engine` 选择。

    · `rapidocr`（默认）：onnxruntime + PaddleOCR 模型，模型随包分发、离线可用，
      本机实测 2.4–4.4 秒/页。
    · `tesseract`：传统路线，本机 31–69 秒/页（慢一个数量级），且需系统级安装。
    """
    engine = cfg.get("ocr_engine", "rapidocr")

    if engine == "rapidocr":
        if not png.exists():
            raise RuntimeError(f"待 OCR 的图片不存在: {png}")
        result, _elapse = _rapidocr()(str(png))
        # RapidOCR 返回 [[box, text, score], ...]；按行拼接（阅读顺序由它给出）
        if not result:
            return ""
        return "\n".join(str(item[1]) for item in result if len(item) > 1)

    if engine == "tesseract":
        if not shutil.which("tesseract"):
            raise RuntimeError("未找到 tesseract")
        proc = subprocess.run(
            ["tesseract", str(png), "stdout", "-l", cfg["ocr_langs"], "--psm", str(cfg["ocr_psm"])],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"tesseract 失败: {proc.stderr.strip()[:200]}")
        return proc.stdout

    raise RuntimeError(
        f"OCR 引擎未实现: {engine}（已支持 rapidocr / tesseract；"
        "PC 端接 PaddleOCR-GPU 或云端视觉需另加分支）"
    )


def cjk_ratio(text: str) -> float:
    if not text:
        return 0.0
    cjk = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
    return cjk / len(text)


def read_pdf_range(path: Path, start: int, end: int, cfg: dict) -> tuple[str, list[dict]]:
    mupdf = pymupdf()
    doc = mupdf.open(str(path))
    texts, metas = [], []
    try:
        for pno in range(start, min(end, doc.page_count) + 1):
            page = doc[pno - 1]
            raw = (page.get_text() or "").strip()
            method = "text"
            if len(raw) < int(cfg["text_layer_min_chars"]):
                tmp = Path(tempfile.gettempdir()) / f"books-ocr-{os.getpid()}-p{pno}.png"
                page.get_pixmap(dpi=int(cfg["dpi"]), colorspace=mupdf.csGRAY).save(str(tmp))
                try:
                    raw = ocr_image(tmp, cfg).strip()
                finally:
                    tmp.unlink(missing_ok=True)
                method = "ocr"
            ratio = cjk_ratio(raw)
            ok = len(raw) >= int(cfg["quality_min_chars"]) and (ratio >= float(cfg["quality_min_cjk_ratio"]) or ratio == 0.0)
            metas.append({
                "page": pno,
                "method": method,
                "chars": len(raw),
                "cjk_ratio": round(ratio, 3),
                "quality": "ok" if ok else "needs_vision",
            })
            texts.append(f"----- p{pno} ({method}) -----\n{raw}")
    finally:
        doc.close()
    return "\n\n".join(texts), metas


def cmd_read(args, cfg, rec: RunRecorder) -> dict:
    out = Path(args.out)
    probes = read_jsonl(out / "_probe.jsonl")
    hit = next((r for r in probes if r["book_id"] == args.book), None)
    if hit is None:
        # 允许用书名片段定位：把书名/查询都归一化成 slug 形态（·、（）、空格 → -），
        # 这样 "技术史-第1卷" 能命中 book_id，也容忍书名里的全角符号。
        def norm(x: str) -> str:
            return re.sub(r"[^\w\u4e00-\u9fff]+", "-", str(x)).strip("-").lower()

        q = norm(args.book or "")
        cand = [r for r in probes if q and (q in r["book_id"].lower() or q in norm(r.get("title", "")))]
        if len(cand) == 1:
            hit = cand[0]
        elif len(cand) > 1:
            raise SystemExit("书名不唯一，请用 book_id：" + ", ".join(c["book_id"] for c in cand[:5]))
        else:
            raise SystemExit(f"未在 _probe.jsonl 找到 {args.book}（先跑 probe）")
    path = Path(hit["path"])
    if not path.exists():
        raise SystemExit(f"源文件不可达（本机可能只有部分数据）：{path}")
    start, end = parse_pages(args.pages)
    budget = int(cfg["page_budget"])
    if end - start + 1 > budget and not args.force:
        end = start + budget - 1
        log(f"[限制] 页数超过预算 {budget}，截断为 {start}-{end}（--force 覆盖）")
    book_dir = out / "cache" / hit["book_id"]
    cache = book_dir / f"p{start:04d}-{end:04d}.txt"
    if cache.exists() and not args.refresh:
        rec.bump("cache_hit")
        log(f"缓存命中: {cache}")
        return {"cache": "hit", "file": str(cache), "pages": [start, end]}

    t0 = time.time()
    if path.suffix.lower() == ".pdf":
        text, metas = read_pdf_range(path, start, end, cfg)
    elif path.suffix.lower() == ".epub":
        names, _ = epub_entries(path)
        parts = []
        with zipfile.ZipFile(path) as zf:
            for pno in range(start, min(end, len(names)) + 1):
                parts.append(f"----- p{pno} (epub) -----\n{html_to_text(zf.read(names[pno - 1]).decode('utf-8', 'replace'))}")
        text = "\n\n".join(parts)
        metas = [{"page": p, "method": "epub", "chars": len(parts[p - start]), "cjk_ratio": round(cjk_ratio(parts[p - start]), 3), "quality": "ok"} for p in range(start, min(end, len(names)) + 1)]
    else:
        text = path.read_text(encoding="utf-8", errors="replace") if path.suffix.lower() in (".txt", ".md") else ""
        metas = [{"page": 1, "method": "direct", "chars": len(text), "cjk_ratio": round(cjk_ratio(text), 3), "quality": "ok" if text else "unsupported"}]

    if not args.dry_run:
        safe_write(cache, what="提页缓存")
        guard_mkdir(cache.parent, what="缓存目录")
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(text, encoding="utf-8")
        append_jsonl(book_dir / "meta.jsonl", {
            "ts": now_iso(),
            "book_id": hit["book_id"],
            "title": hit.get("title"),
            "source_path": str(path),
            "page_start": start,
            "page_end": end,
            "sha256_source": sha256_of(path),
            "device": hostname(),
            "role": cfg.get("role"),
            "elapsed_ms": int((time.time() - t0) * 1000),
            "pages": metas,
            "needs_vision": [m["page"] for m in metas if m["quality"] != "ok"],
        })
    rec.bump("extracted")
    log(f"提取完成 {hit['book_id']} p{start}-{end}: {len(text)} 字符 → {cache}")
    bad = [m["page"] for m in metas if m["quality"] != "ok"]
    if bad:
        log(f"[质量门] 页码 {bad} 未过门（cjk_ratio/长度）→ 标 needs_vision：请走云端视觉或 PC worker")
    return {"cache": "miss", "file": str(cache), "pages": [start, end], "chars": len(text), "needs_vision": bad}


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            b = fh.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()[:16]


def parse_pages(spec: str) -> tuple[int, int]:
    m = re.match(r"^(\d+)(?:-(\d+))?$", (spec or "").strip())
    if not m:
        raise SystemExit(f"页码格式应为 N 或 N-M，收到: {spec!r}")
    a = int(m.group(1))
    b = int(m.group(2) or a)
    return (a, b) if a <= b else (b, a)


# ── 遍历 / 报告 ────────────────────────────────────────────────────────────


def resolve_roots(args, cfg) -> list[Path]:
    roots = [Path(args.root)] if args.root else [Path(r) for r in cfg.get("library_roots", [])]
    # 登记"绝对限制"守卫：**在过滤存在性之前**登记，这样即使 --root 指向不存在的路径，
    # 之后任何试图写进该路径的动作也会被拒绝（不依赖目录当前是否存在）。
    guard_library_roots(roots)
    roots = [r for r in roots if r.exists()]
    if not roots:
        raise SystemExit("没有可用书库根：用 --root 指定，或在配置里写 library_roots")
    return roots


def iter_books(roots: list[Path], limit: int | None = None, skip_hidden: bool = True):
    seen = 0
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            if skip_hidden:
                dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for name in sorted(filenames):
                if Path(name).suffix.lower() not in BOOK_EXTS:
                    continue
                yield Path(dirpath) / name
                seen += 1
                if limit and seen >= limit:
                    return


def cmd_probe(args, cfg, rec: RunRecorder) -> dict:
    roots = resolve_roots(args, cfg)
    persist_roots(roots, args.dry_run)
    out = Path(args.out)
    counts: dict[str, int] = {}
    for path in iter_books(roots, args.limit):
        info = probe_file(path, cfg)
        info["probed_at"] = now_iso()
        append_jsonl(out / "_probe.jsonl", info, args.dry_run)
        counts[info.get("strategy", "?")] = counts.get(info.get("strategy", "?"), 0) + 1
        rec.bump("probed")
        if args.json:
            log(json.dumps(info, ensure_ascii=False))
        else:
            log(f"  {info['book_id'][:34]:34} {info.get('pages', '?'):>5}页 目录{info.get('outline_entries', 0):>4} 文字层{'有' if info.get('text_layer') else '无'} → {info.get('strategy')}")
    return {"roots": [str(r) for r in roots], "strategies": counts}


def latest_probes(probes: list[dict]) -> list[dict]:
    """把探测记录**按 book_id 去重**，每条取最后一次。

    为什么需要（2026-10-13 实测）：`_probe.jsonl` 是**追加式日志**（每次 probe 都往后写），
    而 report 原先直接 `len(probes)` 当书数。连续跑两次 probe 后，报告写出
    "书库：2573 本 / 210.12 GB"，而真实是 1280 本 / 104.53 GB —— **数字翻倍且没有提示**。
    日志追加本身是对的（要留历史），错的是"把日志行数当书籍数"。
    去重后取最后一条，顺带让早期失败记录（如装 PyMuPDF 之前的 MissingPdfLib）
    被后续成功记录覆盖，不再污染统计。
    """
    latest: dict[str, dict] = {}
    for r in probes:
        key = r.get("book_id")
        if not key:
            continue
        latest[key] = r
    return list(latest.values())


def cmd_report(args, cfg, rec: RunRecorder) -> dict:
    out = Path(args.out)
    probes = read_jsonl(out / "_probe.jsonl")
    if not probes:
        raise SystemExit("尚无 _probe.jsonl：先跑 probe")
    books = latest_probes(probes)
    strategies: dict[str, int] = {}
    fmts: dict[str, int] = {}
    for r in books:
        strategies[r.get("strategy", "?")] = strategies.get(r.get("strategy", "?"), 0) + 1
        fmts[r.get("format", "?")] = fmts.get(r.get("format", "?"), 0) + 1
    idx = sorted((out / "index").glob("*.jsonl")) if (out / "index").exists() else []
    idx_rows = sum(len(read_jsonl(p)) for p in idx)
    cache_files = sorted((out / "cache").glob("*/*.txt")) if (out / "cache").exists() else []
    cache_chars = sum(p.stat().st_size for p in cache_files)
    total_mb = sum(r.get("size_mb", 0) or 0 for r in books)
    lines = [
        "# 书籍知识库 · 探测报告",
        "",
        f"- 生成时间：{now_iso()}    角色：`{cfg.get('role')}`    设备：`{hostname()}`",
        f"- 记录目录：`{out}`",
        f"- 书库：{len(books)} 本 / {total_mb / 1024:.2f} GB",
        f"- 格式：{', '.join(f'{k}×{v}' for k, v in sorted(fmts.items()))}",
        f"- 建议策略：{', '.join(f'{k}×{v}' for k, v in sorted(strategies.items()))}",
        f"- 已建索引：{len(idx)} 本 / {idx_rows} 章；已缓存：{len(cache_files)} 段 / {cache_chars / 1024:.1f} KB",
    ]
    if len(probes) != len(books):
        lines.append(
            f"- 注：探测日志共 {len(probes)} 行，按 book_id 去重后为 {len(books)} 本"
            f"（日志是追加式的，重复跑 probe 会留历史；统计以去重结果为准）"
        )
    lines += [
        "",
        "| book_id | 页 | 目录条 | 文字层 | 体积MB | 策略 | 标题 |",
        "|---|---:|---:|:--:|---:|---|---|",
    ]
    for r in sorted(books, key=lambda x: (x.get("strategy", ""), x.get("book_id", ""))):
        lines.append(
            f"| `{r['book_id']}` | {r.get('pages', '?')} | {r.get('outline_entries', 0)} | "
            f"{'有' if r.get('text_layer') else '无'} | {r.get('size_mb', 0)} | {r.get('strategy')} | {r.get('title', '')} |"
        )
    text = "\n".join(lines) + "\n"
    if not args.dry_run:
        safe_write(out / "_report.md", what="探测报告")
        (out / "_report.md").write_text(text, encoding="utf-8")
    rec.bump("reported")
    log(text)
    return {"books": len(books), "probe_lines": len(probes),
            "index_files": len(idx), "cache_files": len(cache_files)}


# ── selftest：零外部依赖的自检（合成 PDF） ─────────────────────────────────


def make_synthetic_pdf(path: Path, pages: int = 4, with_toc: bool = True) -> None:
    mupdf = pymupdf()
    doc = mupdf.open()
    for i in range(1, pages + 1):
        page = doc.new_page()
        page.insert_text((72, 100), f"Chapter {i}", fontsize=20)
        for line in range(12):
            page.insert_text(
                (72, 140 + line * 14),
                f"line {line}: alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu",
                fontsize=11,
            )
    if with_toc:
        doc.set_toc([[1, "Chapter 1", 1], [1, "Chapter 2", 3]])
    doc.save(str(path))
    doc.close()


def make_image_only_pdf(src: Path, dst: Path, page_no: int = 1) -> None:
    """把某页渲染成位图后重新组装为"无文字层"的 PDF（模拟扫描件）。"""
    mupdf = pymupdf()
    src_doc = mupdf.open(str(src))
    pix = src_doc[page_no - 1].get_pixmap(dpi=150)
    png = Path(tempfile.gettempdir()) / f"books-selftest-{os.getpid()}.png"
    pix.save(str(png))
    out = mupdf.open()
    page = out.new_page(width=pix.width, height=pix.height)
    page.insert_image(page.rect, filename=str(png))
    out.save(str(dst))
    out.close()
    src_doc.close()
    png.unlink(missing_ok=True)


def cmd_selftest(args, cfg, rec: RunRecorder) -> dict:
    checks: list[tuple[str, bool, str]] = []

    def check(name: str, cond: bool, detail: str = "") -> None:
        checks.append((name, bool(cond), detail))

    tmp = Path(tempfile.mkdtemp(prefix="my-pi-books-selftest-"))
    out = tmp / "out"
    rec.out = out  # 自检的 run log 也进临时目录，不污染真实记录
    library = tmp / "library"
    library.mkdir(parents=True)
    # 运行时配置也重定向到临时目录：`cmd_probe` 会 persist_roots，默认写全局配置文件，
    # 于是自检的**临时书库根**会覆盖用户真实的 `library_roots`（实测缺陷，见 runtime_config_path 注释）。
    _prev_runtime_cfg = os.environ.get("PI_BOOKS_RUNTIME_CONFIG")
    os.environ["PI_BOOKS_RUNTIME_CONFIG"] = str(tmp / "runtime-config.json")
    try:
        pdf = library / "synthetic-chinese-book.pdf"
        make_synthetic_pdf(pdf)
        scanned = library / "synthetic-scanned.pdf"
        make_image_only_pdf(pdf, scanned)

        cfg2 = dict(cfg)
        cfg2["library_roots"] = [str(library)]
        cfg2["ocr_langs"] = "eng"  # 自检不依赖中文字体与语言包

        ns = argparse.Namespace(root=None, out=str(out), limit=None, json=False, dry_run=False, force=False)
        probes = []
        for path in iter_books([library]):
            info = probe_file(path, cfg2)
            probes.append(info)
        by_name = {Path(p["path"]).name: p for p in probes}
        check("probe 识别 PDF 页数", by_name["synthetic-chinese-book.pdf"]["pages"] == 4, str(by_name.get("synthetic-chinese-book.pdf")))
        check("probe 识别内嵌目录", by_name["synthetic-chinese-book.pdf"]["outline_entries"] == 2)
        check("probe 判定文字层可用", by_name["synthetic-chinese-book.pdf"]["text_layer"] is True)
        check("probe 判定扫描件需 OCR", by_name["synthetic-scanned.pdf"]["text_layer"] is False and by_name["synthetic-scanned.pdf"]["strategy"].startswith("needs_toc_ocr"))
        check("book_id 稳定（同文件两次一致）", make_book_id(pdf) == make_book_id(pdf))

        for p in probes:
            append_jsonl(out / "_probe.jsonl", p)
        res = cmd_index(ns, cfg2, rec)
        check("index 生成章节表", res["indexed"] >= 1 and (out / "index").exists())
        rows = read_jsonl(next((out / "index").glob("*.jsonl")))
        check("章节表含页码范围", bool(rows) and rows[0]["page_start"] >= 1 and rows[0]["page_end"] >= rows[0]["page_start"])
        check("无目录书被标记 needs_toc_ocr", res["needs_toc_ocr"] >= 1)

        ns_read = argparse.Namespace(book=by_name["synthetic-chinese-book.pdf"]["book_id"], pages="1-2", out=str(out), refresh=False, force=False, dry_run=False)
        r1 = cmd_read(ns_read, cfg2, rec)
        check("read 首次提取写入缓存", r1["cache"] == "miss" and Path(r1["file"]).exists(), str(r1))
        r2 = cmd_read(ns_read, cfg2, rec)
        check("read 二次命中缓存", r2["cache"] == "hit")
        meta = read_jsonl(Path(r1["file"]).parent / "meta.jsonl")
        check("meta 记录来源与 sha256", bool(meta) and meta[-1]["sha256_source"] and meta[-1]["source_path"].endswith(".pdf"))

        ns_ocr = argparse.Namespace(book=by_name["synthetic-scanned.pdf"]["book_id"], pages="1", out=str(out), refresh=True, force=False, dry_run=False)
        try:
            r3 = cmd_read(ns_ocr, cfg2, rec)
            text = Path(r3["file"]).read_text(encoding="utf-8")
            check("扫描件走 OCR 且输出非空", "----- p1 (ocr) -----" in text and len(text) > 20, text[:60])
        except RuntimeError as exc:
            check("扫描件 OCR（tesseract 缺失则跳过）", "tesseract" in str(exc), str(exc))

        rep = cmd_report(argparse.Namespace(out=str(out), dry_run=False), cfg2, rec)
        check("report 汇总探测/索引/缓存", rep["books"] == 2 and (out / "_report.md").exists())

        # 回归（2026-10-13 实测缺陷）：`_probe.jsonl` 是**追加式日志**，而 report 原先直接数行，
        # 导致重复跑 probe 后「书库 N 本」翻倍（实测 1280 本被报成 2573 本 / 210.12 GB）。
        # 这里再跑一次 probe（日志必然翻倍），断言 report 仍报**去重后**的书籍数。
        cmd_probe(argparse.Namespace(root=str(library), out=str(out), limit=None, json=False, dry_run=False), cfg2, rec)
        probe_lines = len(read_jsonl(out / "_probe.jsonl"))
        rep2 = cmd_report(argparse.Namespace(out=str(out), dry_run=False), cfg2, rec)
        check(
            "probe 日志翻倍后 report 仍报去重后的书籍数（不翻倍）",
            probe_lines > 2 and rep2["books"] == 2 and rep2["probe_lines"] == probe_lines,
            f"日志 {probe_lines} 行 → 报告 {rep2['books']} 本",
        )
        # run log 由 main() 在命令结束后写入 → 这里用临时 recorder 验证同一机制（字段/计数/耗时）
        probe_rec = RunRecorder(Path(rec.out), "selftest-probe", cfg2, ["selftest"], False)
        probe_rec.bump("demo", 2)
        probe_rec.finish(result={"ok": True})
        logfile = Path(rec.out) / "logs" / f"run-{datetime.now().strftime('%Y%m%d')}.jsonl"
        logrows = read_jsonl(logfile)
        check(
            "run log 落盘且含命令/计数/耗时",
            bool(logrows) and logrows[-1]["cmd"] == "selftest-probe" and logrows[-1]["counts"].get("demo") == 2 and "elapsed_ms" in logrows[-1],
            str(logrows[-1] if logrows else None)[:120],
        )

        # ── 绝对限制回归（用户 2026-10-13：绝不破坏书籍源文件）──────────────────
        # 断言四件事：①书库内的写入目标被拒绝；②拒绝是**显式终止**而非静默跳过；
        # ③路径穿越（..）也挡得住（靠 resolve 后的前缀比较）；④不误伤书库外的写入。
        # 全部在自检的临时目录内做：把"书库根"登记为 library，再试图往 library 里写。
        blocked = False
        try:
            safe_write(library / "index" / "x.jsonl", what="自检用的越界写入")
        except SystemExit as exc:
            blocked = "拒绝写入" in str(exc)
        check("绝对限制：写进书库被拒绝（显式终止，非静默跳过）", blocked)

        # `..` 形式：library/a/../x.jsonl resolve 后就是 library/x.jsonl —— 必须同样被拒
        try:
            safe_write(library / "a" / ".." / "x.jsonl", what="自检用的穿越写入")
            traversal_blocked = False
        except SystemExit:
            traversal_blocked = True
        check("绝对限制：路径穿越（..）也被拒绝", traversal_blocked)

        # 拒绝之后，书库目录里除原有的合成书外不应多出任何产物
        extra = sorted(p.name for p in library.rglob("*") if p.is_file()
                       and p.suffix.lower() in (".jsonl", ".md"))
        check("绝对限制：被拒绝后书库内无残留写入", extra == [], str(extra[:4]))

        # 守卫**不误伤**：书库外的写入正常通过
        allowed = True
        try:
            safe_write(out / "guard-probe-ok.jsonl", what="自检用的合法写入")
            (out / "guard-probe-ok.jsonl").write_text("ok", encoding="utf-8")
        except SystemExit:
            allowed = False
        check("绝对限制：书库外的写入不受影响（不误伤）", allowed and (out / "guard-probe-ok.jsonl").exists())
        check("缓存跨设备可迁移（id 由内容指纹决定）", "-" in make_book_id(pdf) and content_fingerprint(pdf) == content_fingerprint(pdf))
    except MissingPdfLib as exc:
        # 缺 PDF 解析库时**跳过**而不是当失败：自检要造合成 PDF，缺库就无从造起。
        # 只记一条 check 说明原因，仍走 finally 清理，返回值照常带 failed 计数（为 0）。
        checks.append(("PDF 解析库（PyMuPDF）——缺失则跳过自检", True, f"跳过：{exc}"))
        print(f"  - 跳过：{exc}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        if _prev_runtime_cfg is None:
            os.environ.pop("PI_BOOKS_RUNTIME_CONFIG", None)
        else:
            os.environ["PI_BOOKS_RUNTIME_CONFIG"] = _prev_runtime_cfg

    failed = [c for c in checks if not c[1]]
    for name, ok, detail in checks:
        log(f"  {'✓' if ok else '❌'} {name}" + (f"  [{detail}]" if detail and not ok else ""))
    rec.bump("selftest_checks", len(checks))
    rec.bump("selftest_failed", len(failed))
    return {"checks": len(checks), "failed": len(failed)}


# ── 入口 ───────────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="书籍知识库框架（探针/索引/按需提取/报告/自检）")
    p.add_argument("cmd", choices=["probe", "index", "read", "report", "selftest"])
    p.add_argument("--root", help="书库根（默认取配置 library_roots）")
    p.add_argument("--out", default=str(DEFAULT_OUT), help="记录目录（默认 portable/memory/knowledge/books）")
    p.add_argument("--config", help="配置文件路径")
    p.add_argument("--limit", type=int, help="只处理前 N 本（试点用）")
    p.add_argument("--book", help="read：book_id 或书名片段")
    p.add_argument("--pages", help="read：页码，如 120-127")
    p.add_argument("--refresh", action="store_true", help="read：忽略缓存重新提取")
    p.add_argument("--force", action="store_true", help="index：覆盖已有索引；read：超过页预算也照做")
    p.add_argument("--dry-run", action="store_true", help="只打印不写文件")
    p.add_argument("--json", action="store_true", help="probe：逐本输出 JSON")
    return p


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    # **绝对限制（用户 2026-10-13）：绝不破坏书籍源文件。**
    # 在入口就登记所有已知书库根（含 --root 与配置里的全部条目），这样**每个子命令**——
    # 包括不解析书库的 `report`——之后的任何写入都会被 safe_write 挡住。
    # `resolve_roots` 里还会再登记一次（含"不存在也要保护"的路径），两者不冲突（登记为替换语义）。
    guard_library_roots(
        ([Path(args.root)] if args.root else []) + [Path(r) for r in cfg.get("library_roots", [])]
    )
    out = Path(args.out)
    rec = RunRecorder(out, args.cmd, cfg, argv, args.dry_run)
    log(f"[books] {args.cmd}  role={cfg.get('role')}  out={out}")
    if args.cmd == "probe":
        result = cmd_probe(args, cfg, rec)
    elif args.cmd == "index":
        result = cmd_index(args, cfg, rec)
    elif args.cmd == "read":
        if not args.book or not args.pages:
            raise SystemExit("read 需要 --book 与 --pages")
        result = cmd_read(args, cfg, rec)
    elif args.cmd == "report":
        result = cmd_report(args, cfg, rec)
    else:
        result = cmd_selftest(args, cfg, rec)
    summary = rec.finish(result=result)
    log(f"[books] 完成 {args.cmd}：{json.dumps(result, ensure_ascii=False)}（{summary['elapsed_ms']}ms，记录已追加）")
    if args.cmd == "selftest" and result.get("failed"):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
