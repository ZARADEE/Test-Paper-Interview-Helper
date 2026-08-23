from __future__ import annotations

import argparse
import base64
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.db import (
    POLITICS_BANK_ID,
    QUESTION_ROOT,
    connect,
    init_db,
    row_to_question,
    utc_now,
    write_question_json,
)
from app.politics import POLITICS_SUBJECT, normalize_politics_tags


GITHUB_API = "https://api.github.com/repos/xyzxyq/kaoyanzhengzhi/contents"
KOolearn_2026_URL = "https://kaoyan.koolearn.com/20251220/1915325.html"
DEFAULT_XIAO_ROOT = Path(r"D:\lenovo\Documents")
XDF_INDEX_URL = "https://kaoyan.xdf.cn/202411/13980322.html"


def fetch_bytes(url: str) -> bytes:
    parts = urllib.parse.urlsplit(url)
    encoded = urllib.parse.urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            urllib.parse.quote(parts.path, safe="/%"),
            parts.query,
            parts.fragment,
        )
    )
    request = urllib.request.Request(encoded, headers={"User-Agent": "paper-helper-politics-import/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def fetch_text(url: str) -> str:
    return fetch_bytes(url).decode("utf-8", errors="replace")


def fetch_json(url: str) -> Any:
    return json.loads(fetch_text(url))


def split_points(value: str) -> list[str]:
    return [item.strip() for item in re.split(r"[,，、;；|]", value) if item.strip()]


def extract_options(area: str) -> tuple[str, list[dict[str, str]]]:
    pattern = re.compile(r"(?<![A-Za-z])([A-DＡ-Ｄ])\s*[.．、:：)]\s*")
    matches = list(pattern.finditer(area))
    if matches:
        options = []
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(area)
            value = re.sub(r"\s+", " ", area[match.end():end]).strip()
            if value:
                options.append(
                    {
                        "key": match.group(1).translate(str.maketrans("ＡＢＣＤ", "ABCD")),
                        "text": value,
                    }
                )
        if len(options) >= 2:
            return area[: matches[0].start()].strip(), options

    marker = re.search(r"(?ms)^\s*A[.．、:：)]\s*\n\s*B[.．、:：)]\s*\n\s*C[.．、:：)]\s*\n\s*D[.．、:：)]", area)
    if marker:
        before = [line.strip() for line in area[: marker.start()].splitlines() if line.strip()]
        if len(before) >= 5:
            option_texts = before[-4:]
            stem = "\n".join(before[:-4])
            return stem, [
                {"key": key, "text": text}
                for key, text in zip(("A", "B", "C", "D"), option_texts)
            ]
    return area.strip(), []


def parse_public_markdown(text: str, year: int) -> list[dict[str, Any]]:
    block_pattern = re.compile(
        r"(?ms)^##\s*第\s*(\d+)\s*题.*?(?=^##\s*第\s*\d+\s*题|\Z)"
    )
    questions: list[dict[str, Any]] = []
    for match in block_pattern.finditer(text):
        number = int(match.group(1))
        block = match.group(0)
        if "### 题目" not in block:
            continue
        area = block.split("### 题目", 1)[1]
        answer_match = re.search(
            r"(?:标\s*准\s*答\s*案|答案)\s*[】\]\[：:、.\s]*([A-DＡ-Ｄ]{1,4})",
            block,
            flags=re.IGNORECASE,
        )
        answer = ""
        if answer_match:
            answer = answer_match.group(1).translate(str.maketrans("ＡＢＣＤ", "ABCD")).upper()
        if not answer:
            continue
        area_answer_match = re.search(
            r"(?:标\s*准\s*答\s*案|答案)\s*[】\]\[：:、.\s]*([A-DＡ-Ｄ]{1,4})",
            area,
            flags=re.IGNORECASE,
        )
        answer_start = area_answer_match.start() if area_answer_match else len(area)
        area = area[:answer_start]
        stem, options = extract_options(area)
        if len(options) < 2:
            continue
        stem = re.sub(r"^\s*\d+\s*[.、)]?\s*", "", stem).strip()
        point_match = re.search(r"知识点\s*[：:]\s*(.*)", block)
        points = split_points(point_match.group(1)) if point_match else []
        chapter = ""
        previous_headings = re.findall(r"(?m)^#{1,6}\s*(.+)$", text[: match.start()])
        if previous_headings:
            chapter = previous_headings[-1].strip()
        major, subtag = normalize_politics_tags(stem, chapter, points)
        questions.append(
            {
                "id": f"politics-{year}-{number:03d}",
                "type": "choice",
                "subject": POLITICS_SUBJECT,
                "stem_markdown": stem,
                "options": options,
                "answer_markdown": answer,
                "analysis_markdown": block[answer_match.end():].strip() if answer_match else "",
                "scoring_points": [],
                "tags": [major, subtag],
                "chapter": chapter or subtag,
                "knowledge_points": points,
                "difficulty": "medium",
                "score": 2,
                "source_page": None,
            }
        )
    return questions


def fetch_year_questions(year: int) -> list[dict[str, Any]]:
    items = fetch_json(f"{GITHUB_API}/{year}")
    questions: list[dict[str, Any]] = []
    for item in items:
        if not item.get("name", "").lower().endswith(".md"):
            continue
        payload = fetch_json(item["url"])
        if payload.get("encoding") == "base64":
            content = base64.b64decode(payload.get("content", "")).decode("utf-8", errors="replace")
        else:
            content = fetch_text(item["download_url"])
        questions.extend(parse_public_markdown(content, year))
    return questions


def parse_local_year_questions(root: Path, year: int) -> list[dict[str, Any]]:
    year_dir = root / str(year)
    if not year_dir.exists():
        return []
    questions: list[dict[str, Any]] = []
    for path in sorted(year_dir.glob("*.md")):
        questions.extend(parse_public_markdown(path.read_text(encoding="utf-8"), year))
    return questions


def parse_koolearn_2026(text: str) -> list[dict[str, Any]]:
    plain = html.unescape(re.sub(r"<[^>]+>", "\n", text))
    blocks = re.split(r"(?m)(?=^\s*\d+\s*[、.．])", plain)
    questions: list[dict[str, Any]] = []
    for block in blocks:
        number_match = re.search(r"(?m)^\s*(\d+)\s*[、.．]", block)
        answer_match = re.search(
            r"(?:\[答案\]|答案\])\s*([A-DＡ-Ｄ]{1,4})",
            block,
            re.IGNORECASE,
        )
        if not number_match or not answer_match:
            continue
        stem_match = re.search(r"\[题干\](.*?)(?=\[选项\])", block, re.S)
        options_match = re.search(r"\[选项\](.*?)(?=(?:\[答案\]|答案\]))", block, re.S)
        if not stem_match or not options_match:
            continue
        stem, options = extract_options(stem_match.group(1) + "\n" + options_match.group(1))
        if len(options) < 2:
            continue
        answer = answer_match.group(1).translate(str.maketrans("ＡＢＣＤ", "ABCD")).upper()
        major, subtag = normalize_politics_tags(stem)
        questions.append(
            {
                "id": f"politics-2026-{int(number_match.group(1)):03d}",
                "type": "choice",
                "subject": POLITICS_SUBJECT,
                "stem_markdown": stem.strip(),
                "options": options,
                "answer_markdown": answer,
                "analysis_markdown": "",
                "scoring_points": [],
                "tags": [major, subtag],
                "chapter": subtag,
                "knowledge_points": [subtag],
                "difficulty": "medium",
                "score": 2,
                "source_page": None,
            }
        )
    return questions


def current_pdf_chapter(prefix: str) -> str:
    lines = [line.strip() for line in prefix.splitlines() if line.strip()]
    for line in reversed(lines):
        if "第" in line and "章" in line:
            return line
    return ""


def parse_xiaorong_pdf(path: Path, answer_key: dict[str, str] | None = None) -> list[dict[str, Any]]:
    import fitz

    answer_key = answer_key or {}
    document = fitz.open(path)
    questions: list[dict[str, Any]] = []
    for page_number, page in enumerate(document, start=1):
        text = page.get_text("text")
        starts = list(re.finditer(r"(?m)^\s*(\d{1,3})\s*[.．、]\s*", text))
        if not starts:
            continue
        for index, start in enumerate(starts):
            end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
            chunk = text[start.start():end].strip()
            stem_area, options = extract_options(chunk)
            if len(options) < 2:
                continue
            number = int(start.group(1))
            stem = re.sub(r"^\s*\d+\s*[.、)]?\s*", "", stem_area).strip()
            prefix = text[: start.start()]
            chapter = current_pdf_chapter(prefix)
            major, subtag = normalize_politics_tags(stem, chapter, [], prefix)
            question_id = f"politics-xiaorong-{page_number:03d}-{number:03d}"
            answer = answer_key.get(question_id) or answer_key.get(f"{page_number}:{number}") or ""
            questions.append(
                {
                    "id": question_id,
                    "type": "choice",
                    "subject": POLITICS_SUBJECT,
                    "stem_markdown": stem,
                    "options": options,
                    "answer_markdown": answer,
                    "analysis_markdown": "",
                    "scoring_points": [],
                    "tags": [major, subtag],
                    "chapter": chapter or subtag,
                    "knowledge_points": [subtag],
                    "difficulty": "medium",
                    "score": 2,
                    "source_page": page_number,
                }
            )
    return questions


def upsert_questions(questions: list[dict[str, Any]], dry_run: bool = False) -> int:
    if dry_run:
        return len(questions)
    now = utc_now()
    with connect() as connection:
        for question in questions:
            existing = connection.execute(
                "SELECT id FROM questions WHERE id=?",
                (question["id"],),
            ).fetchone()
            values = (
                question["type"],
                question["subject"],
                POLITICS_BANK_ID,
                question["stem_markdown"],
                json.dumps(question["options"], ensure_ascii=False),
                question["answer_markdown"],
                question["analysis_markdown"],
                json.dumps(question.get("scoring_points", []), ensure_ascii=False),
                json.dumps(question["tags"], ensure_ascii=False),
                question["chapter"],
                json.dumps(question.get("knowledge_points", []), ensure_ascii=False),
                question.get("difficulty", "medium"),
                question.get("score", 2),
                question.get("source_page"),
                now,
                question["id"],
            )
            if existing:
                connection.execute(
                    """
                    UPDATE questions SET type=?, subject=?, question_bank_id=?,
                        stem_markdown=?, options_json=?,
                        answer_markdown=?, analysis_markdown=?, scoring_points_json=?,
                        tags_json=?, chapter=?, knowledge_points_json=?, difficulty=?,
                        score=?, source_page=?, review_status='approved', updated_at=?
                    WHERE id=?
                    """,
                    values,
                )
            else:
                connection.execute(
                    """
                    INSERT INTO questions(
                        id, type, subject, question_bank_id, stem_markdown, options_json, answer_markdown,
                        analysis_markdown, scoring_points_json, tags_json, chapter,
                        knowledge_points_json, difficulty, score, source_page,
                        review_status, created_at, updated_at
                    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
                    """,
                    (question["id"], *values[:-2], now, now),
                )
            row = connection.execute("SELECT * FROM questions WHERE id=?", (question["id"],)).fetchone()
            if row is not None:
                write_question_json(row_to_question(row), now)
    return len(questions)


def load_answer_key(path: Path | None) -> dict[str, str]:
    if not path or not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {str(key): str(value).upper() for key, value in raw.items()}


def find_default_xiaopdf() -> Path | None:
    if not DEFAULT_XIAO_ROOT.exists():
        return None
    matches = [path for path in DEFAULT_XIAO_ROOT.glob("26*1000*.pdf") if path.is_file()]
    return matches[0] if matches else None


def remove_xiaorong_questions() -> int:
    init_db()
    with connect() as connection:
        rows = connection.execute(
            "SELECT id FROM questions WHERE id LIKE 'politics-xiaorong-%'"
        ).fetchall()
        ids = [row["id"] for row in rows]
        connection.execute(
            "DELETE FROM questions WHERE id LIKE 'politics-xiaorong-%'"
        )
    for question_id in ids:
        (QUESTION_ROOT / f"{question_id}.json").unlink(missing_ok=True)
    return len(ids)


def main() -> int:
    parser = argparse.ArgumentParser(description="导入考研政治真题")
    parser.add_argument("--start-year", type=int, default=2010)
    parser.add_argument("--end-year", type=int, default=2025)
    parser.add_argument("--include-2026", action="store_true")
    parser.add_argument("--source-dir", type=Path, default=None)
    parser.add_argument("--xiaopdf", type=Path, default=None)
    parser.add_argument("--include-xiaorong", action="store_true")
    parser.add_argument("--answer-json", type=Path, default=None)
    parser.add_argument("--remove-xiaorong", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.remove_xiaorong:
        print(json.dumps({"removed_xiaorong": remove_xiaorong_questions()}, ensure_ascii=False))
        return 0

    init_db()
    all_questions: list[dict[str, Any]] = []
    yearly_counts: dict[str, int] = {}
    for year in range(args.start_year, args.end_year + 1):
        try:
            questions = (
                parse_local_year_questions(args.source_dir, year)
                if args.source_dir
                else fetch_year_questions(year)
            )
        except Exception as error:
            print(f"[政治真题] {year} 获取失败：{error}", file=sys.stderr)
            continue
        all_questions.extend(questions)
        yearly_counts[str(year)] = len(questions)

    if args.include_2026:
        try:
            questions = parse_koolearn_2026(fetch_text(KOolearn_2026_URL))
            all_questions.extend(questions)
            yearly_counts["2026"] = len(questions)
        except Exception as error:
            print(f"[政治真题] 2026 获取失败：{error}", file=sys.stderr)

    xiao_path = args.xiaopdf if args.include_xiaorong else None
    xiao_count = 0
    if xiao_path and xiao_path.exists():
        xiao_questions = parse_xiaorong_pdf(xiao_path, load_answer_key(args.answer_json))
        xiao_count = upsert_questions(xiao_questions, args.dry_run)
    public_count = upsert_questions(all_questions, args.dry_run)
    print(
        json.dumps(
            {
                "subject": POLITICS_SUBJECT,
                "public_year_counts": yearly_counts,
                "public_imported": public_count,
                "xiaorong_pdf": str(xiao_path) if xiao_path else None,
                "xiaorong_imported": xiao_count,
                "answer_note": "试题册未包含独立答案表；可通过 --answer-json 补齐答案。",
                "dry_run": args.dry_run,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
