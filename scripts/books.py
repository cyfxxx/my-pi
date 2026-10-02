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
    "ocr_engine": "tesseract",
    "ocr_langs": "chi_sim+eng",
    "ocr_psm": "6",
    "quality_min_chars": 120,
    "quality_min_cjk_ratio": 0.25,
    "privacy_cloud_vision": False,
}

BOOK_EXTS = {".pdf", ".epub", ".txt", ".md", ".docx", ".mobi", ".azw3", ".djvu", ".cp2", ".c2"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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


def persist_roots(roots: list[Path], dry_run: bool) -> None:
    """把本次使用的书库根写进运行时配置（portable/memory/books/config.json），后续命令免重复 --root。"""
    if dry_run or not roots:
        return
    cur = {}
    if DEFAULT_RUNTIME_CONFIG.exists():
        try:
            cur = json.loads(DEFAULT_RUNTIME_CONFIG.read_text(encoding="utf-8"))
        except Exception:
            cur = {}
    merged = [str(r) for r in roots]
    old = list(cur.get("library_roots", []))
    if old != merged:
        cur["library_roots"] = merged
        DEFAULT_RUNTIME_CONFIG.parent.mkdir(parents=True, exist_ok=True)
        DEFAULT_RUNTIME_CONFIG.write_text(json.dumps(cur, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def append_jsonl(path: Path, record: dict, dry_run: bool = False) -> None:
    if dry_run:
        return
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
            "host": os.uname().nodename,
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


def pymupdf():
    try:
        import pymupdf  # type: ignore

        return pymupdf
    except ImportError:
        import fitz  # type: ignore

        return fitz


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
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8") as fh:
            for row in flagged:
                fh.write(json.dumps({**row, "recorded_at": now_iso()}, ensure_ascii=False) + "\n")
    return {"indexed": made, "skipped": skipped, "needs_toc_ocr": len(flagged)}


# ── read：按需提取（缓存优先） ─────────────────────────────────────────────


def ocr_image(png: Path, cfg: dict) -> str:
    engine = cfg.get("ocr_engine", "tesseract")
    if engine != "tesseract":
        raise RuntimeError(f"OCR 引擎未实现: {engine}（可在 PC 端接 PaddleOCR/云端视觉）")
    if not shutil.which("tesseract"):
        raise RuntimeError("未找到 tesseract")
    proc = subprocess.run(
        ["tesseract", str(png), "stdout", "-l", cfg["ocr_langs"], "--psm", str(cfg["ocr_psm"])],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"tesseract 失败: {proc.stderr.strip()[:200]}")
    return proc.stdout


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
            "device": os.uname().nodename,
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


def cmd_report(args, cfg, rec: RunRecorder) -> dict:
    out = Path(args.out)
    probes = read_jsonl(out / "_probe.jsonl")
    if not probes:
        raise SystemExit("尚无 _probe.jsonl：先跑 probe")
    strategies: dict[str, int] = {}
    fmts: dict[str, int] = {}
    for r in probes:
        strategies[r.get("strategy", "?")] = strategies.get(r.get("strategy", "?"), 0) + 1
        fmts[r.get("format", "?")] = fmts.get(r.get("format", "?"), 0) + 1
    idx = sorted((out / "index").glob("*.jsonl")) if (out / "index").exists() else []
    idx_rows = sum(len(read_jsonl(p)) for p in idx)
    cache_files = sorted((out / "cache").glob("*/*.txt")) if (out / "cache").exists() else []
    cache_chars = sum(p.stat().st_size for p in cache_files)
    lines = [
        "# 书籍知识库 · 探测报告",
        "",
        f"- 生成时间：{now_iso()}    角色：`{cfg.get('role')}`    设备：`{os.uname().nodename}`",
        f"- 记录目录：`{out}`",
        f"- 书库：{len(probes)} 本 / {sum(r.get('size_mb', 0) for r in probes) / 1024:.2f} GB",
        f"- 格式：{', '.join(f'{k}×{v}' for k, v in sorted(fmts.items()))}",
        f"- 建议策略：{', '.join(f'{k}×{v}' for k, v in sorted(strategies.items()))}",
        f"- 已建索引：{len(idx)} 本 / {idx_rows} 章；已缓存：{len(cache_files)} 段 / {cache_chars / 1024:.1f} KB",
        "",
        "| book_id | 页 | 目录条 | 文字层 | 体积MB | 策略 | 标题 |",
        "|---|---:|---:|:--:|---:|---|---|",
    ]
    for r in sorted(probes, key=lambda x: x.get("strategy", "")):
        lines.append(
            f"| `{r['book_id']}` | {r.get('pages', '?')} | {r.get('outline_entries', 0)} | "
            f"{'有' if r.get('text_layer') else '无'} | {r.get('size_mb', 0)} | {r.get('strategy')} | {r.get('title', '')} |"
        )
    text = "\n".join(lines) + "\n"
    if not args.dry_run:
        (out / "_report.md").write_text(text, encoding="utf-8")
    rec.bump("reported")
    log(text)
    return {"books": len(probes), "index_files": len(idx), "cache_files": len(cache_files)}


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
        check("缓存跨设备可迁移（id 由内容指纹决定）", "-" in make_book_id(pdf) and content_fingerprint(pdf) == content_fingerprint(pdf))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

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
