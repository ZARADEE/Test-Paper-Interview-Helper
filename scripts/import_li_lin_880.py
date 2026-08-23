from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.db import init_db  # noqa: E402
from app.paired_pdf_import import import_paired_pdfs  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="导入李林 880 题题目册与解析册")
    parser.add_argument("--questions", type=Path, required=True)
    parser.add_argument("--analysis", type=Path, required=True)
    args = parser.parse_args()
    if not args.questions.exists():
        raise SystemExit(f"题目册不存在：{args.questions}")
    if not args.analysis.exists():
        raise SystemExit(f"解析册不存在：{args.analysis}")
    init_db()
    report = import_paired_pdfs(args.questions, args.analysis)
    output = json.dumps(report, ensure_ascii=False, indent=2)
    try:
        print(output)
    except UnicodeEncodeError:
        print(output.encode("ascii", "backslashreplace").decode("ascii"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
