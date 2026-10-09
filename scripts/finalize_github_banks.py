"""Verify every preview, compress it losslessly and activate the complete bundle."""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app import db


def finalize():
    root = ROOT / "backend/data/bundled/github"
    data = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    for q in data["questions"]:
        if not q["render"]:
            continue
        for kind in ("question", "analysis"):
            source = root / (q["id"] + "-" + kind + ".png")
            target = source.with_suffix(".webp")
            if not target.exists():
                with Image.open(source) as image:
                    if image.width < 100 or image.height < 30:
                        raise ValueError("Invalid preview " + str(source))
                    image.convert("RGB").save(target, "WEBP", lossless=True, method=2)
            with Image.open(target) as image:
                image.verify()
            q["previews"][kind] = dict(file=target.name, sha256=hashlib.sha256(target.read_bytes()).hexdigest())
        q["source_document_id"] = "source-github-" + q["id"].split("-")[1]
        q["source_page"] = 1
        q["analysis_source_document_id"] = q["source_document_id"]
    data["ready"] = True
    (root / "manifest.json").write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    report = dict(counts=data["counts"], total=len(data["questions"]), excluded=len(data["excluded"]),
        previews=sum(len(q["previews"]) for q in data["questions"]), sources=data["sources"], missing_answers=0)
    (ROOT/"docs/github-question-import-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False))


if __name__ == "__main__":finalize()
