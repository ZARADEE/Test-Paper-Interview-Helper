"""Build a reviewed, reproducible politics analysis-question supplement."""
from __future__ import annotations

import argparse
from collections import Counter
from difflib import SequenceMatcher
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys
import unicodedata
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.politics import POLITICS_MAJORS

SOURCES = {
    "xyz": {
        "repository": "https://github.com/xyzxyq/kaoyanzhengzhi",
        "commit": "dd3c558f0e003187653435fc2832d8852f6162e7",
        "archive_sha256": "06e5b73b986f95707aeb47500c4e4f487710448d2db272cd1e8d2699d7edf1a8",
    },
    "tseka": {
        "repository": "https://github.com/TsekaLuk/Kaoyan-Politics-Papers",
        "commit": "ba7628fea355977b06c26f864ef6cf967ecfabca",
        "archive_sha256": "523971d579786e1fae78d09ae502ccf36d3a81ee28d449427f96b76909c57d2a",
    },
}
BUNDLE = ROOT / "backend/data/bundled/github/politics-solutions.json"
REPORT = ROOT / "docs/politics-solutions-import-report.json"
KEY = "github_politics_solutions_v1_initialized"
GENERATED = "2026-10-15T00:00:00+08:00"
SUBTAGS = ("哲学", "中国化理论成果", "中国近现代史", "思想道德修养", "国际形势与政策")
ANSWER = re.compile(r"###\s*答案解析|【\s*(?:参考答案|答案要点|答案|标\s*准\s*答\s*案)\s*】")
SUBQUESTION = re.compile(r"[（(]\s*([123])\s*[）)]")


def clean(text: str) -> str:
    text = text.replace("\r", "").replace("\f", "")
    text = re.sub(r"(?m)^[ \t]*找研讯，找真题，找辅导[^\n]*\n?", "", text)
    text = re.sub(r"(?m)^[ \t]*(?:政治试题及解析|20\d\d\s*年思想政治理论试题)[^\n]*\n?", "", text)
    text = re.sub(r"(?m)^[ \t]*\d{1,2}[ \t]*\n", "", text)
    # Join OCR line wraps and spaces inside Chinese words, preserving paragraphs.
    text = re.sub(r"(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])", "", text)
    text = re.sub(r"(?<=[\u3400-\u9fff，、；])\n[ \t]*(?=[\u3400-\u9fff])", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def fingerprint(text: str) -> str:
    text = re.sub(r"^### [^\n]*\n", "", text)
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", text)).lower()


def candidates():
    for source, info in SOURCES.items():
        archive = ROOT / f"frontend/out/politics-source-{source}.zip"
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        if info.get("archive_sha256") and info["archive_sha256"] != digest:
            raise ValueError(f"Source archive changed: {source}")
        info["archive_sha256"] = digest
        with zipfile.ZipFile(archive) as z:
            for path in sorted(z.namelist()):
                year_match = re.search(r"/(20\d\d)/", path)
                if not path.endswith(".md") or "/mayuan/" in path or not year_match:
                    continue
                year = int(year_match[1])
                if year < 2010:
                    continue
                text = z.read(path).decode("utf-8-sig")
                pattern = r"(?m)^##\s*第\s*(\d+)\s*题[^\n]*" if source == "xyz" else r"(?m)^[ \t]*(3[4-8])[.、．][ \t]*"
                headings = list(re.finditer(pattern, text))
                for i, heading in enumerate(headings):
                    number = int(heading[1])
                    if not 34 <= number <= 38:
                        continue
                    block = text[heading.end():headings[i+1].start() if i+1 < len(headings) else len(text)]
                    if source == "xyz":
                        if "### 题目" not in block:
                            continue
                        block = block.split("### 题目", 1)[1].strip()
                        block = re.sub(r"^3[4-8]\s*[.、．]\s*", "", block)
                    yield dict(source=source, year=year, number=number, path=path.split("/", 1)[1],
                               block_sha256=hashlib.sha256(block.encode()).hexdigest(), block=clean(block))


def split_content(c):
    source, year, number, block = c["source"], c["year"], c["number"], c["block"]
    if source == "tseka":
        if year == 2021:
            raise ValueError("材料缩略、错配或未提供完整原题，不导入")
        if year == 2022:
            raise ValueError("只有答案，缺少题面和材料")
        if year == 2023 and number in (35, 36):
            raise ValueError("参考解答仅为作答方向，未提供完整对应要点")
        if year == 2024:
            # This source interleaves each subquestion with its answer.
            marks = list(re.finditer("【解析】", block))
            if len(marks) != 2:
                raise ValueError("无法可靠分离两问与解析")
            q2s = list(re.finditer(r"(?m)^[ \t]*\(2\)", block[marks[0].end():marks[1].start()]))
            if not q2s:
                raise ValueError("缺少第二小问题面")
            q2 = marks[0].end() + q2s[-1].start()
            stem = block[:marks[0].start()] + "\n\n" + block[q2:marks[1].start()]
            answer = "（1）" + block[marks[0].end():q2].strip() + "\n\n（2）" + block[marks[1].end():].strip()
            return clean(stem), clean(answer)
    if source == "xyz":
        if year == 2016:
            raise ValueError("题面存在明显 OCR 错字和遮蔽内容，暂不纳入")
        if year == 2018:
            raise ValueError("小问缺失或 OCR 序号与分值不可靠")
        if year == 2012 and number in (34, 38):
            raise ValueError("题面小问分值合计与原题总分冲突")
        if year == 2024:
            raise ValueError("采用同年另一来源的完整题面与逐问解析，避免重复及答案孤块")
    match = ANSWER.search(block)
    if not match:
        raise ValueError("缺少可分离的参考答案")
    stem, answer = block[:match.start()].strip(), block[match.end():].strip()
    answer = re.sub(r"^\s*(?:3[4-8]\s*[.、．]?\s*)?【[^】]*】\s*", "", answer)
    return clean(stem), clean(answer)


def validate(stem, answer):
    if len(stem) < 150 or len(answer) < 120:
        raise ValueError("题面或参考解答不完整")
    numbers = set(SUBQUESTION.findall(stem))
    if not {"1", "2"}.issubset(numbers) or not numbers.issubset(set(SUBQUESTION.findall(answer))):
        raise ValueError("小问与参考解答序号不对应")
    if ANSWER.search(stem) or "【解析】" in stem:
        raise ValueError("题面混入答案")
    if any(marker in stem + answer for marker in ("![", "<img", "\ufffd", "****")):
        raise ValueError("含未处理图片、乱码或遮蔽内容")


# Explicit, traceable corrections of transcription errors; never fabricate answers.
CORRECTIONS = {
    (2020, 38): [("交资方商品和服务", "交易的是商品和服务"), ("深人人心", "深入人心")],
    (2023, 38): [("全球发展的贡献的维护者", "全球发展的贡献者、国际秩序的维护者")],
    (2024, 35): [("举世嘱目", "举世瞩目"), ("绿色发展奇述", "绿色发展奇迹"), ("塞军坝", "塞罕坝")],
    (2024, 37): [("精神之概", "精神之钙")],
    (2025, 34): [("划获取认识", "获取认识")],
    (2025, 35): [("新时代全面深化取得重大制度成果", "新时代全面深化改革取得重大制度成果")],
}


def build():
    existing = []
    with sqlite3.connect(f"file:{(ROOT / 'backend/data/paper_helper.sqlite3').as_posix()}?mode=ro", uri=True) as c:
        for qid, stem in c.execute("SELECT id,stem_markdown FROM questions WHERE question_bank_id='bank-politics' AND id NOT LIKE 'github-politicssolution-%'"):
            existing.append((qid, fingerprint(stem)))
    chosen, excluded = {}, []
    for item in candidates():
        origin = {k: v for k, v in item.items() if k != "block"}
        try:
            stem, answer = split_content(item)
            validate(stem, answer)
            identity = (item["year"], item["number"])
            if identity in chosen:
                raise ValueError("同年份同题号已收录，保留先选的完整版本")
            normalized = fingerprint(stem)
            for qid, previous in existing:
                if normalized == previous or (min(len(normalized), len(previous)) / max(len(normalized), len(previous), 1) > .85 and SequenceMatcher(None, normalized, previous, autojunk=False).ratio() > .92):
                    raise ValueError("与既有题重复：" + qid)
            chosen[identity] = (item, stem, answer)
        except ValueError as error:
            excluded.append({**origin, "reason": str(error)})
    questions = []
    for (year, number), (item, stem, answer) in sorted(chosen.items()):
        edits = []
        for before, after in CORRECTIONS.get((year, number), []):
            if before in stem + answer:
                stem, answer = stem.replace(before, after), answer.replace(before, after)
                edits.append({"before": before, "after": after, "reason": "修正明确的转写错漏"})
        major, subtag = POLITICS_MAJORS[number - 34], SUBTAGS[number - 34]
        info = SOURCES[item["source"]]
        url = f"{info['repository']}/blob/{info['commit']}/{item['path']}"
        qid = f"github-politicssolution-{year}-{number}"
        provenance = f"来源：{year} 年考研政治真题第 {number} 题；[原始题源]({url})。\n\n分类：{major} / {subtag}。参考解答按题源保留，历史材料按考试当年背景理解。"
        questions.append(dict(
            id=qid, type="solution", subject="考研政治", question_bank_id="bank-politics",
            stem_markdown=f"### {year} 年考研政治真题 · 第 {number} 题\n\n{stem}",
            options=[], answer_markdown=answer, analysis_markdown=provenance,
            scoring_points=[], tags=[major, subtag], chapter=subtag, knowledge_points=[subtag],
            difficulty="medium", score=10, source_document_id="source-github-politicssolution-" + item["source"],
            source_page=None, source_question_number=number, source_regions=[], analysis_regions=[],
            analysis_source_document_id=None, review_status="approved", created_at=GENERATED, updated_at=GENERATED,
            origin=dict(repository=info["repository"], commit=info["commit"], path=item["path"], year=year,
                        number=number, source_block_sha256=item["block_sha256"], classification_basis="2010年起原卷第34–38题的课程模块；按逐题考查内容复核大类与既有子类",
                        content_sha256=hashlib.sha256((stem + "\n" + answer).encode()).hexdigest(), transcription_corrections=edits),
            render=False, previews={},
        ))
    counts = dict(Counter(q["tags"][0] for q in questions))
    sources = [dict(id="politicssolution-" + key, **info, license_note="仓库未声明统一许可；保留原题与参考解答来源") for key, info in SOURCES.items()]
    data = dict(ready=True, generated_at=GENERATED, sources=sources, counts=counts, questions=questions, excluded=excluded)
    BUNDLE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    report = dict(generated_at=GENERATED, total=len(questions), counts=counts,
                  years=dict(sorted(Counter(q["origin"]["year"] for q in questions).items())),
                  sources=sources, excluded=excluded)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps({k: v for k, v in report.items() if k not in ("sources", "excluded")}, ensure_ascii=False))


def apply():
    from app import db
    from app.github_bundle import load_batch
    data = json.loads(BUNDLE.read_text(encoding="utf8"))
    backup = db.DB_PATH.with_name("paper_helper.before-politics-solutions-2026-10-15.sqlite3")
    with db.connect() as connection:
        if connection.execute("SELECT 1 FROM app_metadata WHERE key=?", (KEY,)).fetchone():
            print("Already imported; edits and deletions retained.")
            return
        if backup.exists():
            raise RuntimeError("Backup already exists; inspect before retrying.")
        with sqlite3.connect(backup) as saved:
            connection.backup(saved)
        added = load_batch(connection, data, KEY)
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("Foreign key validation failed")
    for question in data["questions"]:
        path = db.QUESTION_ROOT / (question["id"] + ".json")
        if not path.exists():
            path.write_text(json.dumps(question, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(f"Imported {added}; backup: {backup.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Import the verified bundle into the local database after backup")
    args = parser.parse_args()
    apply() if args.apply else build()
