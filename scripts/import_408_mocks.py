import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"backend"))
from app.db import utc_now

def build():
    raw=json.loads((ROOT/"frontend/out/mock-data.json").read_text(encoding="utf-8"))
    now=utc_now()
    majors={"ds":"数据结构","co":"计算机组成原理","os":"操作系统","cn":"计算机网络"}
    questions=[]
    for original in raw:
        answer=original.get("answerText") if original["type"]=="application" else original.get("answer")
        if not answer or not original.get("explanation"):raise ValueError("Missing answer: "+original["id"])
        stem=original["question"]
        if original.get("code"):stem += "\n\n"+original["code"]["text"]
        analysis=original["explanation"]
        for i,text in enumerate(original.get("optionExplanations",[])):analysis += "\n\n"+chr(65+i)+". "+text
        analysis += "\n\n来源：43aquarius/cs408 · "+original["origin"]+" · 第 "+str(original["number"])+" 题（自创模拟题，保留原参考解答）。"
        questions.append(dict(id="github-408mock-"+original["id"],type="solution" if original["type"]=="application" else "choice",subject="计算机408",question_bank_id="bank-computer-408",
            stem_markdown=stem,options=[dict(key=chr(65+i),text=text) for i,text in enumerate(original.get("options",[]))],answer_markdown=answer,analysis_markdown=analysis,
            tags=[majors[original["subject"]],original["topic"],"模拟题",original["origin"]],chapter=original["topic"],knowledge_points=[original["topic"]],
            difficulty={1:"easy",2:"medium",3:"hard"}[original["difficulty"]],score=original["score"],review_status="approved",created_at=now,updated_at=now,
            source_document_id="source-github-408mock",source_page=1,source_question_number=original["number"],analysis_source_document_id="source-github-408mock",previews={},render=True,
            origin=dict(repository="https://github.com/43aquarius/cs408",path="src/data/mocks/"+original["sourceFile"],source_id=original["id"],paper=original["origin"],kind="mock",visual=original.get("visual"))))
    data=dict(ready=False,generated_at=now,questions=questions,counts=dict(Counter(q["tags"][0] for q in questions)),sources=[dict(id="408mock",repository="https://github.com/43aquarius/cs408",archive_sha256=hashlib.sha256((ROOT/"frontend/out/408-mock-source.zip").read_bytes()).hexdigest())])
    (ROOT/"backend/data/bundled/github/mocks408.json").write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    print(Counter(q["type"] for q in questions))

if __name__=="__main__":build()
