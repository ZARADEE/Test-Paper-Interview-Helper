"""Import every graph exercise, deduplicating identical subject/question/answer triples."""
import base64
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.db import utc_now


class Images(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "img" and attrs.get("alt") and attrs.get("src", "").startswith("data:image/"):
            self.sources[attrs["alt"]] = attrs["src"]


def extract(source):
    raw = Path(source).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != "56b5547d5d0dddec65bfc05cc5ec551f68876af4f756054014e66420acb9c114":
        raise ValueError("Unexpected release checksum")
    payload, _ = json.JSONDecoder().raw_decode(raw.decode().split("window.__ZHJ_OFFLINE__=", 1)[1])
    graph = json.loads(re.search(r'<script[^>]*id="review-data"[^>]*>(.*?)</script>', payload["graphHtml"], re.S).group(1))
    images = Images()
    for subject in graph["subjects"].values():
        for topic in subject["topics"]:
            for concept in topic.get("concepts", []):
                images.feed(concept.get("html", ""))
    destination = ROOT / "backend/data/bundled/zhijing408"
    entries, occurrences = {}, []
    now = utc_now()
    for key, subject in graph["subjects"].items():
        for topic in subject["topics"]:
            for index, exercise in enumerate(topic.get("exercises", [])):
                identity = json.dumps([key, exercise["q"], exercise["a"]], ensure_ascii=False)
                qid = "zhijing408-short-" + hashlib.sha256(identity.encode()).hexdigest()[:20]
                origin = dict(subject=key, topic_id=topic["id"], topic=topic["title"], index=index, source=exercise.get("source"))
                occurrences.append({**origin, "question_id": qid})
                if qid not in entries:
                    entries[qid] = dict(id=qid, type="short_answer", subject="计算机408", question_bank_id="bank-computer-408",
                        stem_markdown=exercise["q"], answer_markdown=exercise["a"], analysis_markdown="来源：智镜408知识点自测简答题。保留原始答案，请自行核对。",
                        options=[], scoring_points=[], tags=[subject["label"], "自测简答题"], chapter=topic["title"], knowledge_points=[],
                        difficulty="medium", score=5, review_status="approved", created_at=now, updated_at=now, previews={}, origins=[])
                entry = entries[qid]
                entry["origins"].append(origin)
                if topic["title"] not in entry["knowledge_points"]:
                    entry["knowledge_points"].append(topic["title"])
                    entry["tags"].append(topic["title"])
                refs = re.findall(r"!\[\[([^]]+)\]\]", exercise["a"])
                if refs:
                    if len(refs) != 1 or refs[0] not in images.sources:
                        raise ValueError("Unresolved answer image: " + qid)
                    data = images.sources[refs[0]]
                    content = base64.b64decode(data.split(",", 1)[1], validate=True)
                    name = qid + "-analysis.webp"
                    (destination / name).write_bytes(content)
                    entry["previews"]["analysis"] = {"file": name, "sha256": hashlib.sha256(content).hexdigest()}
                    entry["analysis_source_document_id"] = "source-zhijing408"
    assert len(occurrences) == graph["stats"]["exerciseCount"] == 87
    assert len(entries) == 48
    result = dict(source="智镜408 v1.1 知识点自测简答题", release_sha256=digest, generated_at=now,
        counts=dict(Counter(q["tags"][0] for q in entries.values())), occurrences=occurrences,
        questions=list(entries.values()), image_count=sum(len(q["previews"]) for q in entries.values()))
    (destination / "short_answers.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"occurrences":len(occurrences),"unique":len(entries),"by_subject":result["counts"],"images":result["image_count"]}, ensure_ascii=False))


if __name__ == "__main__":
    extract(sys.argv[1])
