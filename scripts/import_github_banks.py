"""Build an auditable local supplement from pinned GitHub archive snapshots."""
import hashlib
import html
import json
import re
import sys
import unicodedata
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app import db
from app.math_one import classify_math_one_text
from app.politics import POLITICS_MAJORS, classify_subtag

DEST = ROOT / "backend/data/bundled/github"
REPOS = {"math": "PondFish-me/fish.888.moe", "politics": "mrwoov/kyzz", "408": "lij768423-svg/408-"}


def clean(value):
    return html.unescape(re.sub(r"<[^>]+>", "", str(value or ""))).strip()


def fingerprint(stem):
    stem = re.sub(r"【[^】]*(?:真题|统考)[^】]*】", "", stem)
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", clean(stem))).lower()


def build():
    DEST.mkdir(parents=True, exist_ok=True)
    now = db.utc_now()
    with db.connect() as connection:
        seen = {(q["question_bank_id"], fingerprint(q["stem_markdown"])):q["id"] for q in connection.execute("SELECT * FROM questions WHERE id NOT LIKE 'github-%'")}
    questions, excluded, sources = [], [], []
    for kind, repo in REPOS.items():
        archive = ROOT / f"frontend/out/{kind}-source.zip"
        z = zipfile.ZipFile(archive)
        prefix = z.namelist()[0]
        sources.append(dict(id=kind, repository="https://github.com/"+repo, archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest(), license="ISC (software; third-party questions retain their rights)" if kind=="408" else "No explicit repository license found; retained for requested local study use"))
        for name in z.namelist():
            relative = name[len(prefix):]
            if not relative or name.endswith("/"):continue
            if relative in ("README.md", "LICENSE") or (kind=="math" and (relative.startswith("js/katex/") or relative.startswith("assets/figures/"))) or (kind=="408" and relative.startswith("images/")):
                target=DEST/"assets"/kind/relative
                target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(name))
        raw = []
        if kind == "math":
            for name in z.namelist():
                if name.endswith(".json") and "/data/数学一/" in name:
                    raw.extend((q,name[len(prefix):]) for q in json.loads(z.read(name))["questions"])
        elif kind == "politics":
            for name in z.namelist():
                if re.search(r"/data/\d+\.json$", name):
                    raw.extend(({**q,"year":2000+int(Path(name).stem)},name[len(prefix):]) for q in json.loads(z.read(name))["detail"]["timu"])
        else:
            raw=[(q,"data.json") for q in json.loads(z.read(prefix+"data.json"))["questions"]]
        for original, source_path in raw:
            year=original.get("year")
            if kind=="math":
                stem=original["stem"];options=original.get("options") or {};answer=original.get("answer") or ""
                analysis=original.get("analysis") or "";qtype={"选择题":"choice","填空题":"fill","解答题":"solution","证明题":"solution"}.get(original["type"])
                if not answer and original["type"]=="证明题" and analysis:answer=analysis
                classified=classify_math_one_text(stem+"\n"+original.get("key_point","")+"\n"+analysis[:1000]);tags=classified["tags"];chapter=classified["chapter"];points=classified["knowledge_points"]
                bank,subject="bank-math-one","考研数学一";number=original["index"];oid=str(original["id"])
            elif kind=="politics":
                stem=clean(original["title"]);options={m.group(1):m.group(2).strip() for m in re.finditer(r"(?:^|\|)\s*([A-D])[.．、]\s*(.*?)(?=\|\s*[A-D][.．、]|$)",original.get("xuan_text", ""),re.S)}
                answer=clean(original["right_text"]);analysis=clean(original.get("jiexi"));qtype="choice";number=int(original["num"]);oid=original["timu_id"]
                # Published paper section ranges; recent syllabus moves Xi thought into theory module.
                if number<=4 or 17<=number<=21:major=POLITICS_MAJORS[0]
                elif number<=8 or 22<=number<=26:major=POLITICS_MAJORS[1]
                elif number<=12 or 27<=number<=29:major=POLITICS_MAJORS[2]
                elif number<=14 or 30<=number<=31:major=POLITICS_MAJORS[3]
                else:major=POLITICS_MAJORS[4]
                if year>=2024 and number==1:major=POLITICS_MAJORS[1]
                chapter=classify_subtag(stem+analysis) or dict(zip(POLITICS_MAJORS,["马克思主义原理真题","中国化理论成果","近现代史专题","思想道德与法律基础","历史时政专题"]))[major];tags=[major,chapter];points=[chapter]
                bank,subject="bank-politics","考研政治"
            else:
                stem=original["question"];options=original["options"];answer="".join(original["answer"]);analysis=original.get("explanation","");qtype="choice"
                chapter=original["chapter_title"];tags=[original["book"],chapter];points=[chapter];bank,subject="bank-computer-408","计算机408";number=original["num"];oid=original["id"]
                match=re.search(r"(20\d{2}).{0,6}(?:真题|统考)",stem);year=int(match.group(1)) if match else None
            qid="github-"+kind+"-"+hashlib.sha256(oid.encode()).hexdigest()[:16]
            reason=None
            if not qtype:reason="unsupported source question type"
            elif not stem.strip() or not answer.strip():reason="missing stem or answer"
            elif qtype=="choice" and (len(options)<2 or not set(answer)<=set(options)):reason="invalid options or answer"
            key=(bank,fingerprint(stem))
            if key in seen:reason="duplicate:"+seen[key]
            if reason:excluded.append(dict(id=qid,source_id=oid,kind=kind,reason=reason));continue
            seen[key]=qid
            origin=dict(repository="https://github.com/"+repo,path=source_path,source_id=oid,year=year,number=number,
                classification="source chapter" if kind=="408" else "keyword classification" if kind=="math" else "paper section range with keyword subtag")
            q=dict(id=qid,type=qtype,subject=subject,question_bank_id=bank,stem_markdown=stem,options=[dict(key=k,text=v) for k,v in options.items()],answer_markdown=answer,
                analysis_markdown=analysis,tags=list(dict.fromkeys(tags)),chapter=chapter,knowledge_points=points,difficulty="medium",score=2 if qtype=="choice" else 5,
                review_status="approved",created_at=now,updated_at=now,previews={},origin=origin)
            # Provenance and year are durable metadata, never confused with the two-level study taxonomy.
            q["analysis_markdown"] += "\n\n来源："+repo+(" · "+str(year)+" 年" if year else "")+" · 第 "+str(number)+" 题。原题答案与解析按来源保留。"
            if kind=="politics":q["analysis_markdown"] += "历史真题按当年背景理解。"
            if kind=="math":q["analysis_markdown"] += "分类由关键词归纳，可在系统内修订。"
            # Render self-contained previews for mathematics and any image/formula content.
            text=json.dumps([stem,options,answer,analysis],ensure_ascii=False)
            q["render"] = kind=="math" or "![" in text or "$" in text or "<img" in text
            questions.append(q)
    manifest=dict(version=1,generated_at=now,sources=sources,questions=questions,excluded=excluded,counts=dict(Counter(q["subject"] for q in questions)))
    (DEST/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(dict(importable=manifest["counts"],excluded=len(excluded),render=sum(q["render"] for q in questions)),ensure_ascii=False))


if __name__=="__main__":build()
