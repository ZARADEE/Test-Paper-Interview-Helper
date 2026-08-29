from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.db import (  # noqa: E402
    POLITICS_BANK_ID,
    QUESTION_ROOT,
    connect,
    init_db,
    row_to_question,
    utc_now,
    write_question_json,
)
from app.paired_pdf_import import (  # noqa: E402
    assign_question_regions,
    assign_regions_by_page_and_number,
)
from app.politics import POLITICS_MAJORS, POLITICS_SUBJECT, normalize_politics_tags  # noqa: E402


DEFAULT_ROOT = Path(__file__).resolve().parents[1] / "backend" / "data" / "import_sources" / "politics-2026"
DEFAULT_QUESTION_PDF = DEFAULT_ROOT / "26肖1000-试题册.pdf"
DEFAULT_ANALYSIS_PDF = DEFAULT_ROOT / "26肖秀荣《1000题》解析册.pdf"

QUESTION_START = re.compile(r"(?m)^\s*(\d{1,3})\s*[.．、，,・]\s*")
ANSWER_START = re.compile(
    r"(?m)^\s*(\d{1,3})\s*(?:[.．・、，,]\s*)?(?:答\s*案)\s*([A-DＡ-Ｄ]{0,4})"
)
SOLUTION_START = re.compile(
    r"(?m)^\s*(\d{1,2})\s*(?:[.．・、，,]\s*)?参考答案"
)
OPTION_INLINE = re.compile(
    r"(?ms)^\s*([A-DＡ-Ｄ])(?:\s*[.．、:：),，,-]\s*|\s{1,})(.*?)(?=^\s*[A-DＡ-Ｄ](?:\s*[.．、:：),，,-]\s*|\s{1,})|\Z)"
)
TAIL_LABELS = re.compile(r"(?ms)\n\s*A[.．、:：)]\s*\n\s*B[.．、:：)]\s*\n\s*C[.．、:：)]\s*\n\s*D[.．、:：)]\s*$")
MAJOR_HEADINGS = (
    ("马克思主义基本原理", ("马克思主义基本原理",)),
    (
        "毛泽东思想和中国特色社会主义理论体系",
        (
            "毛泽东思想和中国特色社会主义理论体系概论",
            "毛泽东思想和中国特色社会主义理论体系",
            "习近平新时代中国特色社会主义思想概论",
        ),
    ),
    ("中国近现代史纲要", ("中国近现代史纲要",)),
    ("思想道德与法治", ("思想道德与法治",)),
)
SECTION_HEADINGS = (
    ("single", (r"(?:一|1)[、.．]\s*单项选择题", r"单项选择题")),
    ("multiple", (r"(?:二|2)[、.．]\s*多项选择题", r"多项选择题")),
    ("solution", (r"(?:三|3)[、.．]\s*(?:材料)?分析题", r"(?:材料)?分析题")),
)


def clean_text(value: str) -> str:
    value = value.replace("\x00", "").replace("\ufeff", "")
    value = value.replace("\u3000", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def normalize_for_fingerprint(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower()
    value = re.sub(r"\s+", "", value)
    return re.sub(r"[^\w\u4e00-\u9fff]", "", value)


def fingerprint(stem: str, options: list[dict[str, str]]) -> str:
    option_text = "\n".join(f"{item['key']}:{item['text']}" for item in options)
    payload = normalize_for_fingerprint(f"{stem}\n{option_text}")
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def load_pdf(path: Path) -> tuple[str, list[int]]:
    import fitz

    document = fitz.open(path)
    pages: list[str] = []
    offsets: list[int] = []
    offset = 0
    for page in document:
        blocks = [
            block
            for block in page.get_text("blocks")
            if len(block) >= 7 and block[6] == 0 and clean_text(block[4])
        ]
        blocks.sort(key=lambda block: (round(block[1], 1), round(block[0], 1)))
        text = "\n".join(block[4] for block in blocks)
        offsets.append(offset)
        pages.append(text)
        offset += len(text) + 3
    return "\n\f\n".join(pages), offsets


def page_for_offset(offset: int, page_offsets: list[int]) -> int:
    page = 1
    for index, page_offset in enumerate(page_offsets, start=1):
        if page_offset <= offset:
            page = index
        else:
            break
    return page


def major_boundaries(pages: list[str], page_offsets: list[int]) -> list[tuple[int, str]]:
    boundaries: list[tuple[int, str]] = []
    # Some scans corrupt the chapter title. The five "single choice" starts
    # remain stable and provide a reliable fallback for the political parts.
    single_pages = [
        index
        for index, page in enumerate(pages)
        if "单项选择题" in page[:700]
    ]
    fallback_majors = (
        POLITICS_MAJORS[0],
        POLITICS_MAJORS[1],
        POLITICS_MAJORS[1],
        "中国近现代史纲要",
        "思想道德与法治",
    )
    for index, major in zip(single_pages, fallback_majors):
        boundaries.append((page_offsets[index], major))
    return sorted(set(boundaries))


def value_at_offset(
    offset: int,
    boundaries: list[tuple[int, str]],
    default: str,
) -> str:
    value = default
    for boundary, candidate in boundaries:
        if boundary > offset:
            break
        value = candidate
    return value


def chapter_from_prefix(prefix: str) -> str:
    candidates: list[str] = []
    for raw_line in prefix.splitlines()[-40:]:
        line = clean_text(raw_line)
        if not line:
            continue
        if line == "导论" or re.match(r"^第[一二三四五六七八九十百]+章", line):
            candidates.append(line)
    return candidates[-1] if candidates else ""


def section_boundaries(text: str) -> list[tuple[int, str]]:
    boundaries: list[tuple[int, str]] = []
    for section, aliases in SECTION_HEADINGS:
        for alias in aliases:
            boundaries.extend((match.start(), section) for match in re.finditer(alias, text))
    return sorted(boundaries)


def section_at_offset(offset: int, boundaries: list[tuple[int, str]]) -> str:
    value = "single"
    for boundary, candidate in boundaries:
        if boundary > offset:
            break
        value = candidate
    return value


def extract_options(area: str) -> tuple[str, list[dict[str, str]]]:
    area = clean_text(area)
    matches = list(OPTION_INLINE.finditer(area))
    if len(matches) >= 2:
        options: list[dict[str, str]] = []
        for match in matches:
            value = clean_text(match.group(2))
            if value:
                options.append(
                    {
                        "key": match.group(1).translate(str.maketrans("ＡＢＣＤ", "ABCD")),
                        "text": value,
                    }
                )
        if len(options) >= 2:
            expanded: list[dict[str, str]] = []
            for option in options:
                pieces = list(
                    re.finditer(
                        r"(?<!\w)([A-D])\s*[.．、]\s*",
                        option["text"],
                    )
                )
                if not pieces:
                    expanded.append(option)
                    continue
                first = pieces[0]
                expanded.append({"key": option["key"], "text": clean_text(option["text"][: first.start()])})
                for piece_index, piece in enumerate(pieces):
                    end = pieces[piece_index + 1].start() if piece_index + 1 < len(pieces) else len(option["text"])
                    expanded.append(
                        {
                            "key": piece.group(1),
                            "text": clean_text(option["text"][piece.end():end]),
                        }
                    )
            options = [option for option in expanded if option["text"]]

            # A two-column PDF can append the next question's options to the
            # current block. Keep the first complete A-D run.
            for start_index in range(max(1, len(options) - 3)):
                candidate = options[start_index:start_index + 4]
                if [item["key"] for item in candidate] == ["A", "B", "C", "D"]:
                    options = candidate
                    break
            else:
                unique_options: list[dict[str, str]] = []
                seen_keys: set[str] = set()
                for option in options:
                    if option["key"] in seen_keys:
                        continue
                    unique_options.append(option)
                    seen_keys.add(option["key"])
                    if len(unique_options) == 4:
                        break
                options = unique_options

            if len(options) == 3 and [item["key"] for item in options] == ["A", "B", "C"]:
                tail_match = re.search(r"(?m)^\s*(?:\d+|[•·])\s*[.．•]\s*(.+)$", area)
                if tail_match:
                    options.append({"key": "D", "text": clean_text(tail_match.group(1))})
            return clean_text(area[: matches[0].start()]), options

    tail = TAIL_LABELS.search("\n" + area)
    if tail:
        body = clean_text(area[: tail.start()])
        lines = [clean_text(line) for line in body.splitlines() if clean_text(line)]
        if len(lines) >= 5:
            option_lines = lines[-4:]
            return "\n".join(lines[:-4]).strip(), [
                {"key": key, "text": value}
                for key, value in zip(("A", "B", "C", "D"), option_lines)
            ]
    return area, []


def parse_question_pdf(path: Path) -> list[dict[str, Any]]:
    text, page_offsets = load_pdf(path)
    pages = text.split("\f")
    majors = major_boundaries(pages, page_offsets)
    sections = section_boundaries(text)
    starts = list(QUESTION_START.finditer(text))
    questions: list[dict[str, Any]] = []
    for index, start in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
        raw_block = text[start.start():end]
        number = int(start.group(1))
        body = re.sub(r"^\s*\d{1,3}\s*[.．、，,・]\s*", "", raw_block, count=1)
        body = clean_text(body)
        stem, options = extract_options(body)
        if len(stem) < 8:
            continue

        major = value_at_offset(start.start(), majors, POLITICS_MAJORS[0])
        section = section_at_offset(start.start(), sections)
        if options:
            if section == "solution":
                section = "multiple" if len(options) > 4 else "single"
            question_type = "choice"
            score = 2 if section == "multiple" else 1
        else:
            if section != "solution" and not any(marker in body for marker in ("结合材料", "分析", "说明", "启示")):
                continue
            question_type = "solution"
            score = 10

        chapter = chapter_from_prefix(text[: start.start()])
        major_tag, subtag = normalize_politics_tags(stem, chapter, (), major)
        questions.append(
            {
                "number": number,
                "major": major,
                "section": section,
                "type": question_type,
                "subject": POLITICS_SUBJECT,
                "stem_markdown": stem,
                "options": options,
                "answer_markdown": "",
                "analysis_markdown": "",
                "scoring_points": [],
                "tags": [major_tag, subtag],
                "chapter": chapter,
                "knowledge_points": [subtag] if subtag else [],
                "difficulty": "medium",
                "score": score,
                "source_page": page_for_offset(start.start(), page_offsets),
            }
        )
    return questions


def parse_analysis_pdf(path: Path) -> dict[tuple[str, int, str], dict[str, Any]]:
    text, page_offsets = load_pdf(path)
    pages = text.split("\f")
    majors = major_boundaries(pages, page_offsets)
    sections = section_boundaries(text)
    starts = list(ANSWER_START.finditer(text))
    answers: dict[tuple[str, int, str], dict[str, str]] = {}
    for index, start in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
        raw_block = clean_text(text[start.start():end])
        number = int(start.group(1))
        answer = start.group(2).translate(str.maketrans("ＡＢＣＤ", "ABCD")).upper()
        major = value_at_offset(start.start(), majors, POLITICS_MAJORS[0])
        section = section_at_offset(start.start(), sections)
        if section == "single" and len(answer) > 1:
            section = "multiple"
        elif not answer:
            section = "solution"
        analysis = re.sub(
            r"^\s*\d{1,3}\s*(?:[.．・、]\s*)?(?:答\s*案)\s*[A-DＡ-Ｄ]{0,4}",
            "",
            raw_block,
            count=1,
        ).strip()
        answers[(major, number, section)] = {
            "answer": answer,
            "analysis": analysis,
            "source_page": page_for_offset(start.start(), page_offsets),
        }

    solution_starts = list(SOLUTION_START.finditer(text))
    for index, start in enumerate(solution_starts):
        end = solution_starts[index + 1].start() if index + 1 < len(solution_starts) else len(text)
        raw_block = clean_text(text[start.start():end])
        number = int(start.group(1))
        major = value_at_offset(start.start(), majors, POLITICS_MAJORS[0])
        analysis = re.sub(
            r"^\s*\d{1,2}\s*(?:[.．・、，,]\s*)?参考答案",
            "",
            raw_block,
            count=1,
        ).strip()
        answers[(major, number, "solution")] = {
            "answer": "参考答案",
            "analysis": analysis,
        }
    return answers


def register_source(connection: Any, path: Path, page_count: int, bank_id: str) -> str:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    source_id = f"source-{digest[:16]}"
    connection.execute(
        """
        INSERT OR IGNORE INTO source_documents(
            id, filename, file_type, file_path, sha256, page_count,
            question_bank_id, status, created_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, 'processed', ?)
        """,
        (
            source_id,
            path.name,
            path.suffix.lower().lstrip("."),
            str(path),
            digest,
            page_count,
            bank_id,
            utc_now(),
        ),
    )
    return source_id


def page_region(page: int | None) -> str:
    return json.dumps(
        [{"page": page, "bbox": [0, 0, 10000, 10000]}] if page else [],
        ensure_ascii=False,
    )


def attach_analysis_regions(
    analysis_pdf: Path,
    answers: dict[tuple[str, int, str], dict[str, Any]],
) -> None:
    records = [
        {
            "key": key,
            "number": key[1],
            "match_text": item.get("analysis") or item.get("answer") or "",
            "source_page": item.get("source_page"),
            "source_regions": item.get("source_regions", []),
        }
        for key, item in answers.items()
    ]
    assign_regions_by_page_and_number(analysis_pdf, records)
    for record in records:
        item = answers[record["key"]]
        item["source_regions"] = record.get("source_regions", [])


def import_questions(
    questions: list[dict[str, Any]],
    answers: dict[tuple[str, int, str], dict[str, str]],
    question_source_id: str,
    analysis_source_id: str,
    dry_run: bool,
) -> dict[str, int]:
    stats = {"parsed": len(questions), "inserted": 0, "updated": 0, "duplicates": 0, "unmatched_answers": 0}
    if dry_run:
        for question in questions:
            answer = answers.get((question["major"], question["number"], question["section"]))
            if answer is None and question["type"] != "solution":
                answer = answers.get((question["major"], question["number"], "multiple"))
            if answer is None and question["type"] != "solution":
                stats["unmatched_answers"] += 1
        return stats

    now = utc_now()
    with connect() as connection:
        existing_rows = connection.execute(
            "SELECT * FROM questions WHERE question_bank_id=? OR subject=?",
            (POLITICS_BANK_ID, POLITICS_SUBJECT),
        ).fetchall()
        by_fingerprint = {
            fingerprint(row["stem_markdown"], json.loads(row["options_json"] or "[]")): row
            for row in existing_rows
        }

        for index, question in enumerate(questions, start=1):
            answer = answers.get((question["major"], question["number"], question["section"]))
            if answer is None and question["type"] == "choice":
                answer = answers.get((question["major"], question["number"], "multiple"))
                if answer is None:
                    answer = answers.get((question["major"], question["number"], "single"))
            if answer:
                question["answer_markdown"] = answer["answer"]
                question["analysis_markdown"] = answer["analysis"]
            source_regions = question.get("source_regions") or json.loads(page_region(question["source_page"]))
            analysis_page = answer.get("source_page") if answer else None
            analysis_regions = answer.get("source_regions", []) if answer else []
            if not analysis_regions and analysis_page:
                analysis_regions = json.loads(page_region(analysis_page))

            key = fingerprint(question["stem_markdown"], question["options"])
            existing = by_fingerprint.get(key)
            if existing:
                stats["duplicates"] += 1
                should_update = (
                    bool(question["answer_markdown"] or question["analysis_markdown"])
                    and not existing["answer_markdown"]
                    and not existing["analysis_markdown"]
                )
                if existing["id"].startswith("politics-xiaorong-2026-") and "[0, 0, 0, 0]" in (
                    existing["source_regions_json"] or ""
                ):
                    should_update = True
                if not should_update:
                    continue
                connection.execute(
                    """
                    UPDATE questions SET answer_markdown=coalesce(nullif(?, ''), answer_markdown),
                        analysis_markdown=coalesce(nullif(?, ''), analysis_markdown),
                        source_regions_json=?,
                        analysis_source_document_id=?, analysis_regions_json=?,
                        updated_at=?
                    WHERE id=?
                    """,
                    (
                        question["answer_markdown"],
                        question["analysis_markdown"],
                        json.dumps(source_regions, ensure_ascii=False),
                        analysis_source_id,
                        json.dumps(analysis_regions, ensure_ascii=False)
                        if question["analysis_markdown"]
                        else "[]",
                        now,
                        existing["id"],
                    ),
                )
                updated = connection.execute("SELECT * FROM questions WHERE id=?", (existing["id"],)).fetchone()
                if updated is not None:
                    write_question_json(row_to_question(updated), now)
                stats["updated"] += 1
                continue

            question_id = f"politics-xiaorong-2026-{index:04d}"
            connection.execute(
                """
                INSERT INTO questions(
                    id, type, subject, question_bank_id, stem_markdown, options_json,
                    answer_markdown, analysis_markdown, scoring_points_json, tags_json,
                    chapter, knowledge_points_json, difficulty, score, source_document_id,
                    source_page, review_status, created_at, updated_at,
                    source_regions_json, analysis_source_document_id, analysis_regions_json
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?)
                """,
                (
                    question_id,
                    question["type"],
                    POLITICS_SUBJECT,
                    POLITICS_BANK_ID,
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
                    question_source_id,
                    question["source_page"],
                    now,
                    now,
                    json.dumps(source_regions, ensure_ascii=False),
                    analysis_source_id if question["analysis_markdown"] else None,
                    json.dumps(analysis_regions, ensure_ascii=False)
                    if question["analysis_markdown"]
                    else "[]",
                ),
            )
            row = connection.execute("SELECT * FROM questions WHERE id=?", (question_id,)).fetchone()
            if row is not None:
                write_question_json(row_to_question(row), now)
                by_fingerprint[key] = row
            stats["inserted"] += 1
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="导入 2026 肖秀荣 1000 题并按题面去重")
    parser.add_argument("--question-pdf", type=Path, default=DEFAULT_QUESTION_PDF)
    parser.add_argument("--analysis-pdf", type=Path, default=DEFAULT_ANALYSIS_PDF)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.question_pdf.exists():
        raise SystemExit(f"题目 PDF 不存在：{args.question_pdf}")
    if not args.analysis_pdf.exists():
        raise SystemExit(f"解析 PDF 不存在：{args.analysis_pdf}")

    init_db()
    question_text, question_offsets = load_pdf(args.question_pdf)
    analysis_text, analysis_offsets = load_pdf(args.analysis_pdf)
    questions = parse_question_pdf(args.question_pdf)
    assign_question_regions(args.question_pdf, questions)
    answers = parse_analysis_pdf(args.analysis_pdf)
    attach_analysis_regions(args.analysis_pdf, answers)

    if args.dry_run:
        result = import_questions(
            questions,
            answers,
            "dry-run-question-source",
            "dry-run-analysis-source",
            True,
        )
    else:
        with connect() as connection:
            question_source_id = register_source(connection, args.question_pdf, len(question_text.split("\f")), POLITICS_BANK_ID)
            analysis_source_id = register_source(connection, args.analysis_pdf, len(analysis_text.split("\f")), POLITICS_BANK_ID)
        result = import_questions(
            questions,
            answers,
            question_source_id,
            analysis_source_id,
            False,
        )

    result["answer_blocks"] = len(answers)
    result["question_pages"] = len(question_offsets)
    result["analysis_pages"] = len(analysis_offsets)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
