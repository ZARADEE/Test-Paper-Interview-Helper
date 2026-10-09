"""Authorized 408 data shared by practice, composition and export."""
import io
import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'data/bundled/zhijing408'


@lru_cache(maxsize=1)
def manifest():
    path=ROOT/'manifest.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


@lru_cache(maxsize=1)
def short_answers():
    path = ROOT / "short_answers.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


@lru_cache(maxsize=1)
def preview_index():
    return {q["id"]: q.get("previews", {})
            for data in (manifest(), short_answers()) for q in data.get("questions", [])}


def preview(question, kind):
    source = question.get("source_document_id" if kind == "question" else "analysis_source_document_id")
    if source != "source-zhijing408":
        return None
    item = preview_index().get(question["id"], {}).get(kind)
    if not item:
        return None
    path = (ROOT / item["file"]).resolve()
    if path.parent != ROOT.resolve():
        raise ValueError("Invalid preview path")
    from PIL import Image
    with Image.open(path) as image:
        output = io.BytesIO()
        image.save(output, format="PNG")
        return output.getvalue()


def load(connection):
    from .question_bundle import _insert, JSON_FIELDS
    from .presets import ensure_408

    connection.execute("CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)")
    loaded = 0
    for key, data in (("zhijing408_v1_initialized", manifest()),
                      ("zhijing408_short_answers_v1_initialized", short_answers())):
        if not data or connection.execute("SELECT 1 FROM app_metadata WHERE key=?", (key,)).fetchone():
            continue
        ensure_408(connection)
        _insert(connection, "source_documents", dict(
            id="source-zhijing408", filename=data["source"], file_type="html", file_path="",
            sha256=data["release_sha256"], page_count=0, question_bank_id="bank-computer-408",
            status="processed", created_at=data["generated_at"]))
        for entry in data["questions"]:
            question = {k: v for k, v in entry.items() if k not in ("previews", "origins")}
            for field in JSON_FIELDS:
                question[field + "_json"] = json.dumps(question.pop(field, []), ensure_ascii=False)
            _insert(connection, "questions", question)
        connection.execute("INSERT INTO app_metadata(key,value) VALUES(?,?)", (key, data["release_sha256"]))
        loaded += len(data["questions"])
    return loaded
