"""Compare every upstream question, answer, original image and live database row."""
import base64
import hashlib
import io
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app import db
from app.zhijing_bundle import ROOT as BUNDLE, manifest, short_answers


def audit(source):
    raw = Path(source).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == manifest()["release_sha256"]
    payload, _ = json.JSONDecoder().raw_decode(raw.decode().split("window.__ZHJ_OFFLINE__=", 1)[1])
    paper, _ = json.JSONDecoder().raw_decode(payload["paperHtml"].split('"questions":', 1)[1])
    plain = {q["id"]:q for q in payload["questions"]["questions"]}
    expected = {"zhijing408-" + q["id"]:q for q in paper}
    imported = {q["id"]:q for q in manifest()["questions"]}
    assert set(expected) == set(imported)
    frames_checked = 0
    for qid, original in expected.items():
        entry = imported[qid]
        for field in original:
            if field not in ("questionImages", "explanationImages"):
                assert original[field] == plain[original["id"]][field], (qid, field)
        for source_key, dest_key in [("stem", "stem_markdown"), ("options", "options"), ("answer", "answer_markdown"), ("explanation", "analysis_markdown")]:
            assert original[source_key] == entry[dest_key], (qid, dest_key)
        for field, kind in [("questionImages", "question"), ("explanationImages", "analysis")]:
            images = original.get(field, [])
            assert bool(images) == bool(entry["previews"].get(kind)), (qid, kind)
            if not images:
                continue
            item = entry["previews"][kind]
            content = (BUNDLE / item["file"]).read_bytes()
            assert hashlib.sha256(content).hexdigest() == item["sha256"]
            with Image.open(io.BytesIO(content)) as combined:
                offset, widths = 0, []
                for image in images:
                    with Image.open(io.BytesIO(base64.b64decode(image.split(",", 1)[1]))) as frame:
                        frame = frame.convert("RGB")
                        crop = combined.convert("RGB").crop((0, offset, frame.width, offset + frame.height))
                        assert ImageChops.difference(frame, crop).getbbox() is None, (qid, kind)
                        offset += frame.height + 12
                        widths.append(frame.width)
                        frames_checked += 1
                assert combined.size == (max(widths), offset - 12)
    graph = json.loads(re.search(r'<script[^>]*id="review-data"[^>]*>(.*?)</script>', payload["graphHtml"], re.S).group(1))
    shorts = short_answers()
    indexed = {q["id"]:q for q in shorts["questions"]}
    source_occurrences = []
    for subject, data in graph["subjects"].items():
        for topic in data["topics"]:
            for index, exercise in enumerate(topic.get("exercises", [])):
                source_occurrences.append((subject, topic["id"], index, exercise["q"], exercise["a"]))
    actual = [(o["subject"], o["topic_id"], o["index"], indexed[o["question_id"]]["stem_markdown"], indexed[o["question_id"]]["answer_markdown"]) for o in shorts["occurrences"]]
    assert sorted(source_occurrences) == sorted(actual)
    assert [t.get("exercises", []) for t in graph["topics"]] == [t.get("exercises", []) for t in graph["subjects"]["os"]["topics"]], "Unexpected extra root-topic exercises"
    for entry in shorts["questions"]:
        for item in entry["previews"].values():
            assert hashlib.sha256((BUNDLE / item["file"]).read_bytes()).hexdigest() == item["sha256"]
    all_entries = list(imported.values()) + list(indexed.values())
    with db.connect() as connection:
        rows = {r["id"]:db.row_to_question(r) for r in connection.execute("SELECT * FROM questions WHERE id LIKE 'zhijing408-%'")}
        assert set(rows) == {q["id"] for q in all_entries}
        for entry in all_entries:
            for field in ("type", "stem_markdown", "options", "answer_markdown", "analysis_markdown", "tags", "knowledge_points"):
                assert rows[entry["id"]][field] == entry[field], (entry["id"], field)
        assert not connection.execute("PRAGMA foreign_key_check").fetchall()
    report = dict(release_sha256=digest, choice_questions=len(imported), short_answer_occurrences=len(actual), unique_short_answers=len(indexed),
        total_unique_questions=len(all_entries), missing=0, content_mismatches=0, choice_original_image_frames_checked=frames_checked,
        bundled_preview_files=sum(len(q["previews"]) for q in all_entries), by_subject=dict(Counter(q["tags"][0] for q in all_entries)),
        notes=["87 exercise occurrences resolve to 48 unique short answers; all chapter associations retained.",
               "Source answers preserved verbatim; source quality defects are not silently rewritten."])
    path = ROOT / "docs/zhijing408-audit.json"
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False))


if __name__ == "__main__":
    audit(sys.argv[1])
