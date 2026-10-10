"""Versioned explanation data, shared by practice and the independent reader."""
from functools import lru_cache
import json
from fastapi import APIRouter, HTTPException, Query
from .db import connect, row_to_question
from .github_bundle import ROOT, index

router = APIRouter(prefix="/api/study", tags=["study"])

@lru_cache(maxsize=1)
def explanation_index():
    path = ROOT / "explanations408.json"
    return json.loads(path.read_text(encoding="utf-8"))["items"] if path.exists() else {}

def enrich(question):
    result = dict(question)
    original = index().get(question["id"])
    extra = explanation_index().get(question["id"])
    # Do not attach a source explanation to a question edited into a different one.
    if original and all(question.get(k) == original.get(k) for k in ("stem_markdown", "answer_markdown", "options")):
        result["visual"] = original.get("origin", {}).get("visual")
        if extra and extra["stem"] == question["stem_markdown"]:
            result["option_explanations"] = extra["option_explanations"]
            result["explanation_source"] = {"repository": "https://github.com/43aquarius/cs408",
                "commit": extra["source_commit"], "path": extra["source_path"]}
    return result

@router.get("/diagrams")
def diagrams(search: str = "", kind: str = "", major: str = "", page: int = Query(1, ge=1), page_size: int = Query(24, ge=1, le=200)):
    with connect() as connection:
        rows = connection.execute("SELECT * FROM questions WHERE review_status='approved' AND id LIKE 'github-408mock-%' ORDER BY id").fetchall()
    items = []
    counts = {}
    for row in rows:
        q = enrich(row_to_question(row))
        v = q.get("visual")
        if not v:
            continue
        counts[v["kind"]] = counts.get(v["kind"], 0) + 1
        if kind and v["kind"] != kind or major and major not in q["tags"]:
            continue
        if search.casefold() not in (v["title"] + q["stem_markdown"] + " ".join(q["knowledge_points"])).casefold():
            continue
        items.append({"id": q["id"], "title": v["title"], "kind": v["kind"], "tags": q["tags"], "subject": q["subject"]})
    return {"items": items[(page-1)*page_size:page*page_size], "total": len(items), "counts": counts}

@router.get("/questions/{question_id}")
def read_question(question_id: str):
    with connect() as connection:
        row = connection.execute("SELECT * FROM questions WHERE id=? AND review_status='approved'", (question_id,)).fetchone()
    if not row:
        raise HTTPException(404, "题目不存在或尚未审核。")
    return enrich(row_to_question(row))
