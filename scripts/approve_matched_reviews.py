from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.db import connect, json_load, row_to_question, utc_now, write_question_json
from app.main import QuestionCreate


def main() -> int:
    approved: list[dict] = []
    skipped = 0

    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM review_items WHERE status = 'pending' ORDER BY created_at, id"
        ).fetchall()
        for row in rows:
            parsed = json_load(row["parsed_question_json"], {})
            if not parsed.get("analysis_matched"):
                skipped += 1
                continue

            payload = QuestionCreate.model_validate(parsed)
            data = payload.model_dump()
            question_id = f"question-{uuid.uuid4().hex[:10]}"
            now = utc_now()
            connection.execute(
                """
                INSERT INTO questions(
                    id, type, subject, stem_markdown, options_json, answer_markdown,
                    analysis_markdown, scoring_points_json, tags_json, chapter,
                    knowledge_points_json, difficulty, score, source_document_id,
                    source_page, source_regions_json, analysis_source_document_id,
                    analysis_regions_json, review_status, created_at, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
                """,
                (
                    question_id,
                    data["type"],
                    data["subject"],
                    data["stem_markdown"],
                    json.dumps(data["options"], ensure_ascii=False),
                    data["answer_markdown"],
                    data["analysis_markdown"],
                    json.dumps(data["scoring_points"], ensure_ascii=False),
                    json.dumps(data["tags"], ensure_ascii=False),
                    data["chapter"],
                    json.dumps(data["knowledge_points"], ensure_ascii=False),
                    data["difficulty"],
                    data["score"],
                    row["source_document_id"],
                    data.get("source_page"),
                    json.dumps(data["source_regions"], ensure_ascii=False),
                    data["analysis_source_document_id"],
                    json.dumps(data["analysis_regions"], ensure_ascii=False),
                    now,
                    now,
                ),
            )
            connection.execute(
                "UPDATE review_items SET status = 'approved' WHERE id = ?",
                (row["id"],),
            )
            approved.append(
                {
                    **data,
                    "id": question_id,
                    "source_document_id": row["source_document_id"],
                    "review_status": "approved",
                    "created_at": now,
                    "updated_at": now,
                }
            )

    for question in approved:
        write_question_json(question)

    print(
        json.dumps(
            {
                "approved": len(approved),
                "skipped_without_matched_analysis": skipped,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
