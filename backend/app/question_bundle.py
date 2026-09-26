"""Portable approved questions and original-region previews shipped with the repo."""
from __future__ import annotations

import hashlib
import io
import json
import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA_ROOT = Path(__file__).resolve().parents[1] / "data"
BUNDLE_ROOT = DATA_ROOT / "bundled"
QUESTION_ROOT = DATA_ROOT / "questions"
JSON_FIELDS = ("options", "scoring_points", "tags", "knowledge_points", "source_regions", "analysis_regions")


def preview_signature(question: dict[str, Any], kind: str) -> str:
    analysis = kind == "analysis"
    value = {
        "source": question.get("analysis_source_document_id" if analysis else "source_document_id"),
        "regions": question.get("analysis_regions" if analysis else "source_regions", []),
        "page": None if analysis else question.get("source_page"),
    }
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


@lru_cache(maxsize=1)
def bundle_manifest() -> dict[str, Any]:
    path = BUNDLE_ROOT / "manifest.json"
    if not path.is_file():
        return {}
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("format_version") != 1:
        raise ValueError("Unsupported bundled question format")
    return manifest


@lru_cache(maxsize=1)
def preview_index() -> dict[str, Any]:
    return {item["id"]: item.get("previews", {}) for item in bundle_manifest().get("questions", [])}


def bundle_file(relative: str) -> Path:
    path = (BUNDLE_ROOT / relative).resolve()
    if not path.is_relative_to(BUNDLE_ROOT.resolve()):
        raise ValueError("Invalid bundled asset path")
    return path


def bundled_preview(question: dict[str, Any], kind: str) -> bytes | None:
    entry = preview_index().get(question.get("id"), {}).get(kind)
    if not entry or entry["signature"] != preview_signature(question, kind):
        return None
    path = bundle_file(entry["file"])
    if not path.is_file():
        return None
    # Serve PNG for existing browser, PDF and python-docx consumers; WebP is storage only.
    from PIL import Image
    with Image.open(path) as image:
        output = io.BytesIO()
        image.convert("RGB").save(output, format="PNG")
        return output.getvalue()


def _insert(connection: sqlite3.Connection, table: str, row: dict[str, Any]) -> None:
    allowed = {column[1] for column in connection.execute("PRAGMA table_info(" + table + ")")}
    fields = [key for key in row if key in allowed]
    sql = "INSERT OR IGNORE INTO " + table + " (" + ",".join(fields) + ") VALUES (" + ",".join("?" for _ in fields) + ")"
    connection.execute(sql, [row[key] for key in fields])


def load_bundled_questions(connection: sqlite3.Connection) -> int:
    """Seed only a fresh database, never overwrite records or resurrect deleted questions."""
    manifest = bundle_manifest()
    if not manifest:
        return 0
    connection.execute("CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    key = "bundled_questions_initialized"
    if connection.execute("SELECT 1 FROM app_metadata WHERE key=?", (key,)).fetchone():
        return 0
    if connection.execute("SELECT COUNT(*) FROM questions").fetchone()[0]:
        connection.execute("INSERT INTO app_metadata VALUES (?, ?)", (key, "existing database retained"))
        return 0
    questions = []
    for item in manifest["questions"]:
        path = (QUESTION_ROOT / (item["id"] + ".json")).resolve()
        if path.parent != QUESTION_ROOT.resolve():
            raise ValueError("Invalid bundled question ID")
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != item["sha256"]:
            raise ValueError("Bundled question checksum mismatch: " + item["id"])
        question = json.loads(content)
        if question["id"] != item["id"]:
            raise ValueError("Bundled question ID mismatch")
        for preview in item.get("previews", {}).values():
            if not bundle_file(preview["file"]).is_file():
                raise ValueError("Missing bundled question preview: " + preview["file"])
        for field in JSON_FIELDS:
            question[field + "_json"] = json.dumps(question.pop(field, []), ensure_ascii=False)
        questions.append(question)
    for bank in manifest["banks"]:
        _insert(connection, "question_banks", bank)
    for source in manifest["sources"]:
        _insert(connection, "source_documents", {**source, "file_path": ""})
    for template in manifest["templates"]:
        _insert(connection, "templates", template)
    for question in questions:
        _insert(connection, "questions", question)
    connection.execute("INSERT INTO app_metadata VALUES (?, ?)", (key, manifest["generated_at"]))
    return len(questions)
