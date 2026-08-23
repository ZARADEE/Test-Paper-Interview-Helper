from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.db import (  # noqa: E402
    POLITICS_BANK_ID,
    connect,
    init_db,
    row_to_question,
    utc_now,
    write_question_json,
)
from app.politics import normalize_politics_tags  # noqa: E402


MAJOR_NAMES = (
    "马克思主义基本原理",
    "毛泽东思想和中国特色社会主义理论体系",
    "中国近现代史纲要",
    "思想道德与法治",
    "形势与政策以及当代世界经济与政治",
)
QUESTION_START = re.compile(r"(?m)^\s*(\d{1,3})\s*[.．、)]\s*")
OPTION_START = re.compile(r"(?m)^\s*([A-DＡ-Ｄ])\s*[.．、:：)]\s*")
ANSWER_MARKER = re.compile(
    r"(?:【?\s*答案\s*】?|参考答案|正确答案)\s*[:：]?\s*([A-DＡ-Ｄ]{1,4})",
    re.IGNORECASE,
)


def load_ocr() -> Any:
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError as error:
        raise RuntimeError(
            "缺少 OCR 依赖。请在项目虚拟环境执行："
            " .venv\\Scripts\\python.exe -m pip install -r backend\\requirements-ocr.txt"
        ) from error
    return RapidOCR(print_verbose=False)


def render_page(document: Any, page_index: int, scale: float = 1.8) -> bytes:
    import fitz

    page = document[page_index]
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    return pixmap.tobytes("png")


def ocr_document(path: Path, engine: Any, scale: float) -> list[str]:
    import fitz

    document = fitz.open(path)
    texts: list[str] = []
    for page_index in range(len(document)):
        result, _ = engine(render_page(document, page_index, scale))
        lines = []
        for item in result or []:
            if len(item) >= 2:
                text = str(item[1]).strip()
                if text:
                    lines.append(text)
        texts.append("\n".join(lines))
        if (page_index + 1) % 10 == 0:
            print(f"[OCR] {path.name}: {page_index + 1}/{len(document)}", file=sys.stderr)
    return texts


def clean_text(text: str) -> str:
    value = text.replace("\u3000", " ").replace("\xa0", " ")
    value = value.replace("Ａ", "A").replace("Ｂ", "B").replace("Ｃ", "C").replace("Ｄ", "D")
    value = re.sub(r"[ \t]+", " ", value)
    return value.strip()


def chapter_from_text(text: str, current: str) -> str:
    compact = re.sub(r"\s+", "", text)
    for major in MAJOR_NAMES:
        if major in compact:
            return major
    if "马克思" in compact or "辩证唯物" in compact or "剩余价值" in compact:
        return MAJOR_NAMES[0]
    if "毛泽东" in compact or "中国特色社会主义" in compact or "改革开放" in compact:
        return MAJOR_NAMES[1]
    if "近现代史" in compact or "抗日战争" in compact or "辛亥革命" in compact:
        return MAJOR_NAMES[2]
    if "思想道德" in compact or "法律基础" in compact or "法治" in compact:
        return MAJOR_NAMES[3]
    if "形势与政策" in compact or "当代世界" in compact or "国际" in compact:
        return MAJOR_NAMES[4]
    return current


def split_options(text: str) -> tuple[str, list[dict[str, str]]]:
    matches = list(OPTION_START.finditer(text))
    if len(matches) < 2:
        return text.strip(), []
    options: list[dict[str, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        option_text = clean_text(text[match.end():end])
        if option_text:
            options.append({"key": match.group(1), "text": option_text})
    if len(options) < 2:
        return text.strip(), []
    return clean_text(text[: matches[0].start()]), options


def parse_blocks(page_texts: list[str]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    chapter = ""
    for page_number, page_text in enumerate(page_texts, start=1):
        page_text = clean_text(page_text)
        if not page_text:
            continue
        chapter = chapter_from_text(page_text, chapter)
        starts = list(QUESTION_START.finditer(page_text))
        for index, start in enumerate(starts):
            end = starts[index + 1].start() if index + 1 < len(starts) else len(page_text)
            raw = clean_text(page_text[start.end():end])
            if len(raw) < 4:
                continue
            number = int(start.group(1))
            blocks.append(
                {
                    "page": page_number,
                    "number": number,
                    "chapter": chapter,
                    "raw": raw,
                }
            )
    return blocks


def answer_from_analysis(raw: str) -> str:
    match = ANSWER_MARKER.search(raw)
    if not match:
        return ""
    return match.group(1).upper()


def unique_key(block: dict[str, Any], seen: defaultdict[tuple[str, int], int]) -> tuple[str, int, int]:
    base = (block["chapter"], block["number"])
    occurrence = seen[base]
    seen[base] += 1
    return base[0], base[1], occurrence


def build_questions(
    question_blocks: list[dict[str, Any]],
    analysis_blocks: list[dict[str, Any]],
    question_pdf: Path,
    analysis_pdf: Path,
) -> list[dict[str, Any]]:
    analysis_by_key: defaultdict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for block in analysis_blocks:
        answer = answer_from_analysis(block["raw"])
        if answer:
            analysis_by_key[(block["chapter"], block["number"])].append(block)

    occurrence: defaultdict[tuple[str, int], int] = defaultdict(int)
    used_analysis: Counter[tuple[str, int]] = Counter()
    questions: list[dict[str, Any]] = []
    for block in question_blocks:
        stem, options = split_options(block["raw"])
        key = (block["chapter"], block["number"])
        analysis_list = analysis_by_key[key]
        analysis = analysis_list[used_analysis[key]] if used_analysis[key] < len(analysis_list) else None
        used_analysis[key] += 1
        answer = answer_from_analysis(analysis["raw"]) if analysis else ""
        if len(options) >= 2:
            question_type = "choice"
            score = 2 if len(answer) > 1 else 1
        elif re.search(r"_{2,}|（\s*）|\(\s*\)", block["raw"]):
            question_type = "fill"
            score = 2
        else:
            question_type = "solution"
            score = 10

        major, subtag = normalize_politics_tags(stem, block["chapter"])
        chapter = major if not block["chapter"] else block["chapter"]
        occurrence[key] += 1
        question_id = f"politics-xiao-2023-{len(questions) + 1:04d}"
        questions.append(
            {
                "id": question_id,
                "type": question_type,
                "subject": "考研政治",
                "question_bank_id": POLITICS_BANK_ID,
                "stem_markdown": stem,
                "options": options,
                "answer_markdown": answer,
                "analysis_markdown": analysis["raw"] if analysis else "",
                "scoring_points": [],
                "tags": [major, subtag] if subtag else [major, ""],
                "chapter": chapter,
                "knowledge_points": [subtag] if subtag else [],
                "difficulty": "medium",
                "score": score,
                "source_page": block["page"],
                "source_regions": [{"page": block["page"], "bbox": [0, 0, 1000, 1500]}],
                "analysis_source_document_id": f"source-politics-xiao-2023-analysis-{file_hash(analysis_pdf)}",
                "analysis_regions": (
                    [{"page": analysis["page"], "bbox": [0, 0, 1000, 1500]}] if analysis else []
                ),
                "source_document_id": f"source-politics-xiao-2023-questions-{file_hash(question_pdf)}",
                "analysis_matched": bool(analysis),
            }
        )
    return questions


def file_hash(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[:10]


def register_source(connection: Any, path: Path, source_id: str, now: str) -> None:
    import fitz

    connection.execute(
        """
        INSERT OR REPLACE INTO source_documents(
            id, filename, file_type, file_path, sha256, page_count,
            question_bank_id, status, created_at
        ) VALUES(?, ?, 'pdf', ?, ?, ?, ?, 'processed', ?)
        """,
        (
            source_id,
            path.name,
            str(path),
            file_hash(path),
            len(fitz.open(path)),
            POLITICS_BANK_ID,
            now,
        ),
    )


def save_questions(
    questions: list[dict[str, Any]],
    question_pdf: Path,
    analysis_pdf: Path,
    dry_run: bool,
) -> None:
    if dry_run:
        return
    now = utc_now()
    with connect() as connection:
        register_source(
            connection,
            question_pdf,
            f"source-politics-xiao-2023-questions-{file_hash(question_pdf)}",
            now,
        )
        register_source(
            connection,
            analysis_pdf,
            f"source-politics-xiao-2023-analysis-{file_hash(analysis_pdf)}",
            now,
        )
        connection.execute(
            "DELETE FROM questions WHERE id LIKE 'politics-xiao-2023-%'"
        )
        for question in questions:
            connection.execute(
                """
                INSERT INTO questions(
                    id, type, subject, question_bank_id, stem_markdown, options_json,
                    answer_markdown, analysis_markdown, scoring_points_json, tags_json,
                    chapter, knowledge_points_json, difficulty, score,
                    source_document_id, source_page, source_regions_json,
                    analysis_source_document_id, analysis_regions_json,
                    review_status, created_at, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
                """,
                (
                    question["id"],
                    question["type"],
                    question["subject"],
                    question["question_bank_id"],
                    question["stem_markdown"],
                    json.dumps(question["options"], ensure_ascii=False),
                    question["answer_markdown"],
                    question["analysis_markdown"],
                    json.dumps(question["scoring_points"], ensure_ascii=False),
                    json.dumps(question["tags"], ensure_ascii=False),
                    question["chapter"],
                    json.dumps(question["knowledge_points"], ensure_ascii=False),
                    question["difficulty"],
                    question["score"],
                    question["source_document_id"],
                    question["source_page"],
                    json.dumps(question["source_regions"], ensure_ascii=False),
                    question["analysis_source_document_id"],
                    json.dumps(question["analysis_regions"], ensure_ascii=False),
                    now,
                    now,
                ),
            )
            row = connection.execute(
                "SELECT * FROM questions WHERE id=?",
                (question["id"],),
            ).fetchone()
            if row:
                write_question_json(row_to_question(row), now)


def main() -> int:
    parser = argparse.ArgumentParser(description="OCR 导入 2023 肖秀荣政治 1000 题")
    parser.add_argument("--questions", type=Path, required=True)
    parser.add_argument("--analysis", type=Path, required=True)
    parser.add_argument("--answer", type=Path, default=None)
    parser.add_argument("--scale", type=float, default=1.8)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.questions.exists() or not args.analysis.exists():
        raise SystemExit("题目分册和解析分册必须存在。")

    init_db()
    engine = load_ocr()
    question_pages = ocr_document(args.questions, engine, args.scale)
    analysis_pages = ocr_document(args.analysis, engine, args.scale)
    question_blocks = parse_blocks(question_pages)
    analysis_blocks = parse_blocks(analysis_pages)
    questions = build_questions(question_blocks, analysis_blocks, args.questions, args.analysis)
    save_questions(questions, args.questions, args.analysis, args.dry_run)
    report = {
        "subject": "考研政治",
        "question_bank_id": POLITICS_BANK_ID,
        "question_pages": len(question_pages),
        "analysis_pages": len(analysis_pages),
        "question_blocks": len(question_blocks),
        "analysis_blocks": len(analysis_blocks),
        "imported": 0 if args.dry_run else len(questions),
        "matched_analysis": sum(bool(item["analysis_markdown"]) for item in questions),
        "by_type": dict(Counter(item["type"] for item in questions)),
        "by_major": dict(Counter(item["tags"][0] for item in questions)),
        "dry_run": args.dry_run,
    }
    report_path = ROOT / "backend" / "data" / "politics-2023-xiao-import-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
