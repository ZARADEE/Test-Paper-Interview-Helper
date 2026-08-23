from __future__ import annotations

import hashlib
import io
import json
import re
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Any

from .db import connect, ensure_dirs, utc_now
from .math_one import SUBJECT, chapter_from_text, chapter_group, classify_math_one_text


DIFFICULTY_MAP = {
    "基础题": ("easy", "基础题"),
    "综合题": ("medium", "综合题"),
    "拓展题": ("hard", "拓展题"),
}
TYPE_MAP = {
    "选择题": "choice",
    "填空题": "fill",
    "解答题": "solution",
}
CHAPTER_PATTERN = re.compile(r"第[一二三四五六七八九十百零0-9]+章\s*(.*)$")

# Only parenthesized Arabic/Chinese numbers are top-level question markers.
# Decimal points and formula fragments such as "1." must never start a new item.
QUESTION_START_PATTERN = re.compile(
    r"^\s*(?:[（(]\s*([0-9０-９]{1,2})\s*[）)]|⑴|⑵|⑶|⑷|⑸|⑹|⑺|⑻|⑼|⑽)"
)
ROMAN_QUESTION_NUMBERS = dict(zip("⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽", range(1, 11)))
GROUPS = ("高等数学", "线性代数", "概率统计", "概率论与数理统计")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_pages(path: Path) -> list[tuple[int, str]]:
    try:
        import fitz
    except ImportError as error:
        raise RuntimeError("缺少 PyMuPDF，请先安装后端依赖。") from error
    document = fitz.open(path)
    return [(index + 1, page.get_text("text")) for index, page in enumerate(document)]


def extract_layout_lines(path: Path) -> list[dict[str, Any]]:
    """Read PDF lines with coordinates for reliable question boundaries."""
    try:
        import fitz
    except ImportError as error:
        raise RuntimeError("缺少 PyMuPDF，请先安装后端依赖。") from error

    lines: list[dict[str, Any]] = []
    document = fitz.open(path)
    for page_index, page in enumerate(document):
        layout = page.get_text("dict", sort=True)
        for block in layout.get("blocks", []):
            for line in block.get("lines", []):
                text = "".join(span.get("text", "") for span in line.get("spans", []))
                if not text.strip():
                    continue
                lines.append(
                    {
                        "page": page_index + 1,
                        "page_width": float(page.rect.width),
                        "page_height": float(page.rect.height),
                        "text": text,
                        "bbox": [float(value) for value in line["bbox"]],
                    }
                )
    return lines


def canonical_chapter(raw: str) -> str:
    text = raw.strip()
    if not text:
        return "综合题"
    aliases = {
        "函数、极限、连续": "函数、极限与连续",
        "一元函数微分学及其应用": "一元函数微分学",
        "一元函数积分学及其应用": "一元函数积分学",
        "多元函数微分学及其应用": "多元函数微分学",
        "空间解析几何": "空间解析几何",
        "重积分及其应用": "重积分及其应用",
        "微分方程及其应用": "微分方程",
        "曲线积分与曲面积分": "曲线积分与曲面积分",
        "行列式": "行列式",
        "矩阵": "矩阵",
        "向量": "向量",
        "线性方程组": "线性方程组",
        "相似矩阵": "相似矩阵",
        "二次型": "二次型",
        "随机事件及其概率": "随机事件与概率",
        "随机变量及其分布": "随机变量及其分布",
        "多维随机变量及其分布": "多维随机变量",
        "随机变量的数字特征": "数字特征与大数定律",
        "大数定律与中心极限定理": "数字特征与大数定律",
        "数理统计的基本概念": "数理统计",
        "参数估计": "参数估计",
        "假设检验": "假设检验",
    }
    for source, target in aliases.items():
        if source in text:
            return target
    chapter, confidence = chapter_from_text(text)
    return chapter if confidence >= 0.42 else text


def clean_line(line: str) -> str:
    value = line.replace("\u00a0", " ").strip()
    if not value:
        return ""
    # The first answer line in the analysis PDF has a broken glyph mapping:
    # "（1）C." is extracted as "（DC.". Restore the marker for pairing.
    value = re.sub(r"^[（(]D[CＣ][.．]?", "(1) C.", value)
    if re.fullmatch(r"[0-9０-９]{1,3}", value):
        return ""
    if "李林考研数学系列" in value or "精讲精练880题" in value:
        return ""
    return value


def question_start(line: str) -> int | None:
    match = QUESTION_START_PATTERN.match(line)
    if not match:
        return None
    if match.group(1):
        return int(match.group(1).translate(str.maketrans("０１２３４５６７８９", "0123456789")))
    for marker, number in ROMAN_QUESTION_NUMBERS.items():
        if line.lstrip().startswith(marker):
            return number
    return None


def parse_state_transition(
    line: str,
    state: dict[str, Any],
) -> tuple[bool, dict[str, Any], bool]:
    """Return whether the line is a section header and the next state."""
    next_state = dict(state)
    chapter_match = CHAPTER_PATTERN.search(line)
    if chapter_match:
        next_state["chapter"] = canonical_chapter(chapter_match.group(1))
        next_state["group"] = state["group"] if state["group"] in GROUPS else chapter_group(next_state["chapter"])
        resets_numbering = (
            next_state["chapter"] != state["chapter"]
            or next_state["group"] != state["group"]
        )
        return True, next_state, resets_numbering

    if line in GROUPS:
        next_state["group"] = "概率论与数理统计" if line == "概率统计" else line
        return True, next_state, next_state["group"] != state["group"]

    difficulty_label = next(
        (label for label in DIFFICULTY_MAP if label in line and len(line) <= 40),
        None,
    )
    if difficulty_label:
        next_state["difficulty"], next_state["difficulty_label"] = DIFFICULTY_MAP[difficulty_label]
        return True, next_state, next_state["difficulty_label"] != state["difficulty_label"]

    question_type = next(
        (label for label in TYPE_MAP if label in line and len(line) <= 40),
        None,
    )
    if question_type:
        next_state["question_type"] = TYPE_MAP[question_type]
        return True, next_state, next_state["question_type"] != state["question_type"]
    return False, next_state, False


def parse_pdf_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    state = {
        "group": "高等数学",
        "chapter": "综合题",
        "difficulty": "medium",
        "difficulty_label": "综合题",
        "question_type": "solution",
    }
    current: dict[str, Any] | None = None
    current_page: int | None = None
    current_page_height = 0.0
    current_region_start = 28.0
    expected_number = 1

    def close_region(end_y: float | None = None) -> None:
        nonlocal current_region_start
        if current is None or current_page is None:
            return
        region_end = end_y if end_y is not None else current_page_height - 18
        if region_end <= current_region_start + 2:
            return
        current["source_regions"].append(
            {
                "page": current_page,
                "bbox": [
                    24.0,
                    max(0.0, current_region_start),
                    max(24.0, current["page_width"]),
                    min(current_page_height, region_end),
                ],
            }
        )
        current_region_start = current_page_height

    def finalize() -> None:
        nonlocal current
        if current is None:
            return
        close_region()
        text = "\n".join(current["lines"]).strip()
        if text:
            current["raw_text"] = text
            current["key"] = (
                current["group"],
                current["chapter"],
                current["difficulty_label"],
                current["question_type"],
                current["number"],
            )
            records.append(current)
        current = None

    for item in extract_layout_lines(path):
        page_number = item["page"]
        if current_page != page_number:
            if current is not None:
                close_region()
            current_page = page_number
            current_page_height = item["page_height"]
            current_region_start = 28.0

        line = clean_line(item["text"])
        if not line:
            continue

        is_header, next_state, resets_numbering = parse_state_transition(line, state)
        if is_header:
            if current is not None and resets_numbering:
                finalize()
            state = next_state
            if resets_numbering:
                expected_number = 1
            continue

        number = question_start(line)
        if number is not None and number > 0:
            # One source page has a visually printed "三、解答题" heading
            # that is absent from the PDF text layer. A fill-question
            # sequence restarting at 1 is the reliable layout fallback.
            if (
                number == 1
                and expected_number > 1
                and current is not None
                and state["question_type"] == "fill"
            ):
                close_region(item["bbox"][1] - 3)
                finalize()
                state = dict(state)
                state["question_type"] = "solution"
                expected_number = 1

            # A lower number is normally an internal sub-question marker.
            # A higher number can still be valid when the PDF text layer
            # dropped the preceding question marker.
            if number < expected_number:
                if current is not None:
                    current["lines"].append(line)
                continue
            if current is not None:
                close_region(item["bbox"][1] - 3)
                finalize()
            current_region_start = max(0.0, item["bbox"][1] - 4)
            current = {
                "number": number,
                "page": page_number,
                "page_width": item["page_width"],
                "group": state["group"],
                "chapter": state["chapter"],
                "difficulty": state["difficulty"],
                "difficulty_label": state["difficulty_label"],
                "question_type": state["question_type"],
                "lines": [line],
                "source_regions": [],
            }
            expected_number = number + 1
            continue

        if current is not None:
            current["lines"].append(line)

    finalize()
    return records


def split_options(stem: str) -> tuple[str, list[dict[str, str]]]:
    options: list[dict[str, str]] = []
    option_pattern = re.compile(r"(?m)^\s*([A-DＡ-Ｄ])\s*[.．、:：]\s*(.+)$")
    for match in option_pattern.finditer(stem):
        key = match.group(1).translate(str.maketrans("ＡＢＣＤ", "ABCD"))
        if key not in {option["key"] for option in options}:
            options.append({"key": key, "text": match.group(2).strip()})
    if not options:
        return stem, options
    cleaned = option_pattern.sub("", stem)
    return cleaned.strip(), options


def split_analysis_answer(raw_text: str, question_type: str) -> tuple[str, str]:
    text = raw_text.strip()
    choice_marker = re.match(
        r"^\s*[（(]\s*\d{1,2}\s*[）)]\s*([A-DＡ-Ｄ])\s*[.．、]?\s*",
        text,
    )
    if question_type == "choice" and choice_marker:
        answer = choice_marker.group(1).translate(str.maketrans("ＡＢＣＤ", "ABCD"))
        return answer, text[choice_marker.end() :].strip()

    number_marker = re.match(r"^\s*[（(]\s*\d{1,2}\s*[）)]\s*", text)
    if question_type == "fill" and number_marker:
        remainder = text[number_marker.end() :].strip()
        answer = remainder.splitlines()[0].strip() if remainder else ""
        return answer, remainder
    return "", text


def pair_question_and_analysis(
    question_records: list[dict[str, Any]],
    analysis_records: list[dict[str, Any]],
    analysis_source_document_id: str,
) -> list[dict[str, Any]]:
    analysis_by_key: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for record in analysis_records:
        analysis_by_key[record["key"]].append(record)

    paired: list[dict[str, Any]] = []
    for index, question in enumerate(question_records, start=1):
        matches = analysis_by_key.get(question["key"], [])
        analysis = matches.pop(0) if matches else None
        stem, options = split_options(question["raw_text"])
        classified = classify_math_one_text(
            f"{question['chapter']}\n{question['difficulty_label']}\n{stem}",
            question["chapter"],
        )
        if question["chapter"] and question["chapter"] != "综合题":
            classified["chapter"] = question["chapter"]
            classified["tags"] = [question["group"], question["chapter"]]

        answer, analysis_text = split_analysis_answer(
            analysis["raw_text"] if analysis else "",
            question["question_type"],
        )
        paired.append(
            {
                "id": f"li-lin-880-{index:04d}",
                "type": question["question_type"],
                "subject": SUBJECT,
                "stem_markdown": stem,
                "options": options,
                "answer_markdown": answer,
                "analysis_markdown": analysis_text,
                "scoring_points": [],
                "tags": classified["tags"],
                "chapter": question["chapter"],
                "knowledge_points": classified["knowledge_points"],
                "difficulty": question["difficulty"],
                "score": 5 if question["question_type"] != "solution" else 10,
                "source_page": question["page"],
                "source_question_number": question["number"],
                "source_category": question["difficulty_label"],
                "source_regions": question["source_regions"],
                "analysis_regions": analysis["source_regions"] if analysis else [],
                "analysis_source_document_id": analysis_source_document_id,
                "analysis_matched": bool(analysis),
                "confidence": 0.72 if analysis else 0.48,
                "review_status": "pending",
            }
        )
    return paired


def register_source(connection: sqlite3.Connection, path: Path, source_id: str, now: str) -> None:
    page_count = len(extract_pages(path))
    connection.execute(
        """
        INSERT OR IGNORE INTO source_documents(
            id, filename, file_type, file_path, sha256, page_count, status, created_at
        ) VALUES(?, ?, 'pdf', ?, ?, ?, 'processed', ?)
        """,
        (source_id, path.name, str(path), sha256_file(path), page_count, now),
    )


def import_paired_pdfs(question_pdf: Path, analysis_pdf: Path) -> dict[str, Any]:
    ensure_dirs()
    question_sha256 = sha256_file(question_pdf)
    question_source_id = f"source-li-lin-880-questions-{question_sha256[:10]}"
    analysis_source_id = f"source-li-lin-880-analysis-{sha256_file(analysis_pdf)[:10]}"
    question_records = [item for item in parse_pdf_records(question_pdf) if item["page"] >= 8]
    analysis_records = [item for item in parse_pdf_records(analysis_pdf) if item["page"] >= 7]
    questions = pair_question_and_analysis(question_records, analysis_records, analysis_source_id)
    now = utc_now()

    with connect() as connection:
        register_source(connection, question_pdf, question_source_id, now)
        register_source(connection, analysis_pdf, analysis_source_id, now)
        connection.execute(
            "DELETE FROM review_items WHERE id LIKE 'review-li-lin-880-%' AND status = 'pending'"
        )
        stale_question_sources = connection.execute(
            "SELECT id FROM source_documents WHERE sha256 = ? AND id != ?",
            (question_sha256, question_source_id),
        ).fetchall()
        stale_removed = 0
        for stale_source in stale_question_sources:
            cursor = connection.execute(
                "DELETE FROM review_items WHERE source_document_id = ? AND status = 'pending'",
                (stale_source["id"],),
            )
            stale_removed += cursor.rowcount
        imported = 0
        for question in questions:
            review_id = f"review-{question['id']}"
            if connection.execute("SELECT id FROM review_items WHERE id = ?", (review_id,)).fetchone():
                continue
            connection.execute(
                """
                INSERT INTO review_items(
                    id, source_document_id, raw_text, parsed_question_json,
                    confidence, status, review_notes, created_at
                ) VALUES(?, ?, ?, ?, ?, 'pending', ?, ?)
                """,
                (
                    review_id,
                    question_source_id,
                    question["stem_markdown"],
                    json.dumps(question, ensure_ascii=False),
                    question["confidence"],
                    "" if question["analysis_matched"] else "解析册未按当前规则匹配，需人工核对。",
                    now,
                ),
            )
            imported += 1

    matched = sum(1 for item in questions if item["analysis_matched"])
    report = {
        "question_pdf": str(question_pdf),
        "analysis_pdf": str(analysis_pdf),
        "question_pages": len(extract_pages(question_pdf)),
        "analysis_pages": len(extract_pages(analysis_pdf)),
        "title_expected_questions": 880,
        "parsed_questions": len(question_records),
        "parsed_analyses": len(analysis_records),
        "parser_overcount_blocks": max(0, len(question_records) - 880),
        "imported_review_items": imported,
        "stale_pending_items_removed": stale_removed,
        "matched_analysis": matched,
        "unmatched_analysis": max(0, len(analysis_records) - matched),
        "by_group": dict(
            __import__("collections").Counter(
                item["tags"][0] if item["tags"] else "待分类" for item in questions
            )
        ),
        "by_type": dict(__import__("collections").Counter(item["type"] for item in questions)),
        "status": "pending_review",
    }
    report_path = Path(__file__).resolve().parents[1] / "data" / "li-lin-880-import-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def render_source_preview(path: Path, regions: list[dict[str, Any]], scale: float = 1.55) -> bytes:
    """Render one or more source PDF regions into a single PNG preview."""
    try:
        import fitz
        from PIL import Image
    except ImportError as error:
        raise RuntimeError("预览 PDF 需要 PyMuPDF 和 Pillow。") from error

    document = fitz.open(path)
    images: list[Any] = []
    for region in regions[:8]:
        page_number = int(region.get("page", 0))
        bbox = region.get("bbox", [])
        if page_number < 1 or page_number > len(document) or len(bbox) != 4:
            continue
        page = document[page_number - 1]
        rect = fitz.Rect(*[float(value) for value in bbox]) & page.rect
        if rect.is_empty or rect.width < 2 or rect.height < 2:
            continue
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=rect, alpha=False)
        images.append(Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples))

    if not images:
        raise ValueError("没有可渲染的题目版面区域。")

    canvas_width = min(1800, max(image.width for image in images))
    resized: list[Any] = []
    for image in images:
        if image.width > canvas_width:
            image = image.resize((canvas_width, round(image.height * canvas_width / image.width)))
        resized.append(image)
    canvas = Image.new(
        "RGB",
        (canvas_width, sum(image.height for image in resized) + 12 * (len(resized) - 1)),
        "white",
    )
    offset = 0
    for image in resized:
        canvas.paste(image, (0, offset))
        offset += image.height + 12
    output = io.BytesIO()
    canvas.save(output, format="PNG", optimize=True)
    return output.getvalue()
