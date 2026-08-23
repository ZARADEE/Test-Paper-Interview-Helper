from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .math_one import classify_math_one_text


@dataclass
class DocumentPage:
    page_number: int
    text: str


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_document(path: Path) -> list[DocumentPage]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return extract_pdf(path)
    if suffix == ".docx":
        return extract_docx(path)
    if suffix == ".doc":
        return extract_doc(path)
    raise ValueError("暂不支持该文件格式，请选择 PDF、DOCX 或 DOC。")


def extract_pdf(path: Path) -> list[DocumentPage]:
    try:
        import fitz
    except ImportError as error:
        raise RuntimeError("缺少 PyMuPDF，请重新安装后端依赖。") from error

    document = fitz.open(path)
    return [DocumentPage(index + 1, page.get_text("text")) for index, page in enumerate(document)]


def extract_docx(path: Path) -> list[DocumentPage]:
    try:
        from docx import Document
    except ImportError as error:
        raise RuntimeError("缺少 python-docx，请重新安装后端依赖。") from error

    document = Document(path)
    paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
    table_text = []
    for table in document.tables:
        for row in table.rows:
            table_text.append(" | ".join(cell.text.strip() for cell in row.cells))
    text = "\n".join([*paragraphs, *table_text])
    return [DocumentPage(1, text)]


def extract_doc(path: Path) -> list[DocumentPage]:
    libreoffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not libreoffice:
        raise RuntimeError("解析 DOC 需要 LibreOffice，请安装后重试。")

    with tempfile.TemporaryDirectory(prefix="paper-helper-doc-") as temp_dir:
        output_dir = Path(temp_dir)
        command = [
            libreoffice,
            "--headless",
            "--convert-to",
            "docx",
            "--outdir",
            str(output_dir),
            str(path),
        ]
        result = subprocess.run(command, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "DOC 转换失败。")
        converted = output_dir / f"{path.stem}.docx"
        if not converted.exists():
            raise RuntimeError("LibreOffice 未生成转换后的 DOCX 文件。")
        return extract_docx(converted)


def split_question_candidates(pages: list[DocumentPage]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    pattern = re.compile(r"(?m)^\s*(\d{1,3})\s*[.、)]\s*")
    for page in pages:
        matches = list(pattern.finditer(page.text))
        if not matches:
            text = page.text.strip()
            if text:
                candidates.append(build_candidate(text, page.page_number, 0.45))
            continue
        for index, match in enumerate(matches):
            start = match.start()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(page.text)
            raw = page.text[start:end].strip()
            if raw:
                candidates.append(build_candidate(raw, page.page_number, 0.78))
    return candidates


def build_candidate(raw_text: str, page_number: int, confidence: float) -> dict[str, Any]:
    classified = classify_math_one_text(raw_text)
    math_signal = any(
        keyword in raw_text
        for keyword in ("极限", "导数", "积分", "矩阵", "行列式", "随机变量", "概率", "方程")
    )
    if not math_signal:
        classified.update(
            {
                "subject": "待分类",
                "tags": [],
                "chapter": "",
                "knowledge_points": [],
                "confidence": min(confidence, 0.45),
            }
        )
    else:
        classified["confidence"] = min(confidence, float(classified.get("confidence", confidence)))
    return {
        **classified,
        "stem_markdown": raw_text,
        "answer_markdown": "",
        "analysis_markdown": "",
        "scoring_points": [],
        "source_page": page_number,
    }
