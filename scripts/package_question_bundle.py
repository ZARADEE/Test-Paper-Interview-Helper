"""Publish approved JSON and lossless cropped previews, without personal runtime data."""
from __future__ import annotations

import hashlib
import io
import json
import re
import sqlite3
import sys
from collections import Counter
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.paired_pdf_import import render_source_preview_document
from app.question_bundle import BUNDLE_ROOT, JSON_FIELDS, QUESTION_ROOT, preview_signature


def write_changed(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_bytes() != content:
        path.write_bytes(content)


def main() -> None:
    import fitz
    from PIL import Image
    db_path = ROOT / "backend/data/paper_helper.sqlite3"
    with sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute("BEGIN")
        questions = [dict(row) for row in connection.execute("SELECT * FROM questions ORDER BY id")]
        banks = [dict(row) for row in connection.execute("SELECT * FROM question_banks ORDER BY id")]
        templates = [dict(row) for row in connection.execute("SELECT * FROM templates ORDER BY id")]
        sources = {row["id"]: dict(row) for row in connection.execute("SELECT * FROM source_documents")}
    manifest_path = BUNDLE_ROOT / "manifest.json"
    previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    previous_items = {item["id"]: item for item in previous.get("questions", [])}
    records, used_sources, image_count, image_bytes = [], set(), 0, 0
    with ExitStack() as stack:
        documents = {}
        for index, question in enumerate(questions, 1):
            question_id = question["id"]
            if not re.fullmatch(r"[a-zA-Z0-9_-]+", question_id):
                raise ValueError("Unsafe question ID: " + question_id)
            for field in JSON_FIELDS:
                question[field] = json.loads(question.pop(field + "_json", "[]"))
            content = json.dumps(question, ensure_ascii=False, indent=2).encode("utf-8")
            write_changed(QUESTION_ROOT / (question_id + ".json"), content)
            record = {"id": question_id, "sha256": hashlib.sha256(content).hexdigest(), "previews": {}}
            for kind, source_field, region_field in (("question", "source_document_id", "source_regions"), ("analysis", "analysis_source_document_id", "analysis_regions")):
                source_id = question.get(source_field)
                regions = question.get(region_field, [])
                if source_id in sources:
                    used_sources.add(source_id)
                if not regions:
                    continue
                source = sources.get(source_id)
                if not source:
                    raise ValueError("Missing source metadata: " + str(source_id))
                relative = "previews/" + question_id + "-" + kind + ".webp"
                target = BUNDLE_ROOT / relative
                signature = preview_signature(question, kind)
                old = previous_items.get(question_id, {}).get("previews", {}).get(kind, {})
                reusable = old.get("signature") == signature and old.get("source_sha256") == source["sha256"] and target.is_file()
                if not reusable:
                    if source_id not in documents:
                        documents[source_id] = stack.enter_context(fitz.open(source["file_path"]))
                    png = render_source_preview_document(documents[source_id], regions)
                    with Image.open(io.BytesIO(png)) as image:
                        buffer = io.BytesIO()
                        image.save(buffer, format="WEBP", lossless=True, method=3)
                    write_changed(target, buffer.getvalue())
                image_content = target.read_bytes()
                record["previews"][kind] = {"file": relative, "sha256": hashlib.sha256(image_content).hexdigest(), "source_sha256": source["sha256"], "signature": signature}
                image_count += 1
                image_bytes += len(image_content)
            records.append(record)
            if index % 100 == 0 or index == len(questions):
                print(f"Packaged {index}/{len(questions)} questions, {image_count} previews, {image_bytes / 1048576:.1f} MiB", flush=True)
    portable_sources = [{**sources[key], "file_path": ""} for key in sorted(used_sources)]
    manifest = {
        "format_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
        "counts": {"questions": len(records), "by_subject": dict(Counter(q["subject"] for q in questions)), "previews": image_count, "preview_bytes": image_bytes},
        "banks": banks, "templates": templates, "sources": portable_sources, "questions": records,
    }
    write_changed(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    print(json.dumps(manifest["counts"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
