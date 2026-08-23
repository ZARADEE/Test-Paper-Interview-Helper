from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.parse
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.db import connect, init_db, utc_now  # noqa: E402
from app.math_one import split_markdown_questions  # noqa: E402


PUBLIC_REPO = "https://github.com/TsekaLuk/Kaoyan-Math1-Papers"
PUBLIC_RAW_ROOT = "https://raw.githubusercontent.com/TsekaLuk/Kaoyan-Math1-Papers/main/"
PUBLIC_API_TREE = "https://api.github.com/repos/TsekaLuk/Kaoyan-Math1-Papers/git/trees/main?recursive=1"


def fetch_public_markdown(destination: Path, years: set[int]) -> list[Path]:
    destination.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(PUBLIC_API_TREE, timeout=30) as response:
            tree = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        cached = load_source_files(destination, years)
        if cached:
            print(f"公开接口暂时不可用（HTTP {error.code}），改用本地缓存：{destination}")
            return cached
        raise RuntimeError(f"读取公开题源目录失败（HTTP {error.code}），请稍后重试或使用 --source-dir") from error
    files: list[Path] = []
    for item in tree.get("tree", []):
        path = item.get("path", "")
        if not path.startswith("papers/") or not path.endswith(".md"):
            continue
        year_match = re.search(r"(19|20)\d{2}", Path(path).name)
        if not year_match or int(year_match.group(0)) not in years:
            continue
        target = destination / Path(path).name
        url = PUBLIC_RAW_ROOT + urllib.parse.quote(path, safe="/")
        with urllib.request.urlopen(url, timeout=30) as response:
            target.write_bytes(response.read())
        files.append(target)
    return files


def load_source_files(source_dir: Path, years: set[int]) -> list[Path]:
    files = []
    for path in sorted(source_dir.glob("*.md")):
        year_match = re.search(r"(19|20)\d{2}", path.name)
        if year_match and int(year_match.group(0)) in years:
            files.append(path)
    return files


def make_source_id(path: Path) -> str:
    return f"source-math-one-{hashlib.sha1(str(path).encode('utf-8')).hexdigest()[:10]}"


def import_review_queue(files: list[Path]) -> tuple[int, Counter[str]]:
    imported = 0
    breakdown: Counter[str] = Counter()
    with connect() as connection:
        for path in files:
            year_match = re.search(r"(19|20)\d{2}", path.name)
            if not year_match:
                continue
            year = int(year_match.group(0))
            source_id = make_source_id(path)
            now = utc_now()
            content = path.read_text(encoding="utf-8")
            sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
            connection.execute(
                """
                INSERT OR IGNORE INTO source_documents(
                    id, filename, file_type, file_path, sha256, page_count, status, created_at
                ) VALUES(?, ?, 'markdown', ?, ?, 1, 'processed', ?)
                """,
                (source_id, path.name, str(path), sha, now),
            )
            questions = split_markdown_questions(content, year, path.name)
            for question in questions:
                existing = connection.execute(
                    "SELECT id FROM review_items WHERE id = ?",
                    (f"review-{question['id']}",),
                ).fetchone()
                if existing:
                    continue
                review_id = f"review-{question['id']}"
                confidence = float(question.pop("confidence", 0.5))
                connection.execute(
                    """
                    INSERT INTO review_items(
                        id, source_document_id, raw_text, parsed_question_json,
                        confidence, status, review_notes, created_at
                    ) VALUES(?, ?, ?, ?, ?, 'pending', '', ?)
                    """,
                    (
                        review_id,
                        source_id,
                        question["stem_markdown"],
                        json.dumps(question, ensure_ascii=False),
                        confidence,
                        now,
                    ),
                )
                imported += 1
                breakdown[f"{question['type']} / {question['chapter']}"] += 1
    return imported, breakdown


def main() -> int:
    parser = argparse.ArgumentParser(description="导入公开或本地数学一 Markdown 题源到待审核队列")
    parser.add_argument("--source-dir", type=Path, default=ROOT / "backend" / "data" / "sources" / "math-one")
    parser.add_argument("--year", type=int, action="append", dest="years")
    parser.add_argument("--fetch-public", action="store_true")
    args = parser.parse_args()

    years = set(args.years or [2025])
    if args.fetch_public and 2026 in years:
        print("提示：公开题源仓库当前仅列出至 2025 年，未找到可确认的 2026 年 Markdown 文件。")
        years.discard(2026)
    if not years:
        return 0

    init_db()
    files = []
    if args.fetch_public:
        files.extend(fetch_public_markdown(args.source_dir, years))
    files.extend(path for path in load_source_files(args.source_dir, years) if path not in files)
    if not files:
        print(f"未找到源文件：{args.source_dir}")
        return 1

    imported, breakdown = import_review_queue(files)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_repository": PUBLIC_REPO if args.fetch_public else "local",
        "years": sorted(years),
        "files": [path.name for path in files],
        "imported": imported,
        "breakdown": dict(breakdown),
        "status": "pending_review",
    }
    report_path = ROOT / "backend" / "data" / "math-one-import-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
