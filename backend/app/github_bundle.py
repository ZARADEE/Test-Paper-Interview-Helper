"""Versioned GitHub study supplement; load once without overwriting user edits."""
import io
import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "data/bundled/github"


@lru_cache(maxsize=1)
def manifest():
    path = ROOT / "manifest.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return data if data.get("ready") else {}


@lru_cache(maxsize=1)
def solutions408():
    path = ROOT / "solutions408.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return data if data.get("ready") else {}


@lru_cache(maxsize=1)
def mocks408():
    path = ROOT / "mocks408.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return data if data.get("ready") else {}


@lru_cache(maxsize=1)
def politics_solutions():
    path = ROOT / "politics-solutions.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return data if data.get("ready") else {}


@lru_cache(maxsize=1)
def index():
    return {q["id"]: q for data in (manifest(), solutions408(), mocks408(), politics_solutions()) for q in data.get("questions", [])}


def preview(question, kind):
    item = index().get(question.get("id"), {}).get("previews", {}).get(kind)
    if not item:
        return None
    expected = "source-github-" + question["id"].split("-")[1]
    if question.get("source_document_id" if kind == "question" else "analysis_source_document_id") != expected:
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
    return sum(load_batch(connection, data, key) for data, key in (
        (manifest(), "github_study_supplement_v1_initialized"),
        (solutions408(), "github_408_solutions_v1_initialized"),
        (mocks408(), "github_408_mocks_v1_initialized"),
        (politics_solutions(), "github_politics_solutions_v1_initialized"),
    ))


def load_batch(connection, data, key):
    from .question_bundle import _insert, JSON_FIELDS
    if not data:
        return 0
    if connection.execute("SELECT 1 FROM app_metadata WHERE key=?", (key,)).fetchone():
        return 0
    banks = {"math":"bank-math-one", "politics":"bank-politics", "408":"bank-computer-408", "408solution":"bank-computer-408", "408mock":"bank-computer-408"}
    banks.update({"politicssolution-xyz": "bank-politics", "politicssolution-tseka": "bank-politics"})
    for source in data["sources"]:
        _insert(connection, "source_documents", dict(id="source-github-"+source["id"], filename=source["repository"],
            file_type="json", file_path="", sha256=source["archive_sha256"], page_count=0,
            question_bank_id=banks[source["id"]], status="processed", created_at=data["generated_at"]))
    for entry in data["questions"]:
        question = {k:v for k,v in entry.items() if k not in ("previews", "origin", "render")}
        for field in JSON_FIELDS:
            question[field+"_json"] = json.dumps(question.pop(field, []), ensure_ascii=False)
        _insert(connection, "questions", question)
    connection.execute("INSERT INTO app_metadata(key,value) VALUES(?,?)", (key,data["generated_at"]))
    return len(data["questions"])
