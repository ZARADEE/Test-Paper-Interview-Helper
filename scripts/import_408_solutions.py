"""Extract complete 408 comprehensive problems and worked solutions from GitHub."""
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.db import utc_now
DEST = ROOT / "backend/data/bundled/github"
STAGING = ROOT / "frontend/out/408-solutions"


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text, self.hidden = [], 0
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "title"): self.hidden += 1
        if tag in ("p", "div", "br", "tr", "pre"): self.text.append("\n")
    def handle_endtag(self, tag):
        if tag in ("script", "style", "title"): self.hidden = max(0, self.hidden - 1)
    def handle_data(self, data):
        if not self.hidden: self.text.append(data)


def plain(markup):
    parser = PlainText(); parser.feed(markup)
    return re.sub(r"\n\s*\n+", "\n\n", "".join(parser.text)).strip()


def build():
    archive = ROOT / "frontend/out/408-full-source.zip"
    source = zipfile.ZipFile(archive)
    STAGING.mkdir(parents=True, exist_ok=True)
    questions, excluded = [], []
    now = utc_now()
    for name in sorted(source.namelist()):
        if "/408_questions_full/" not in name or not name.endswith(".json"): continue
        for row in json.loads(source.read(name)):
            q = row["question"]
            if q["questionIndex"] <= 40: continue
            year, number = q["year"], q["questionIndex"]
            texts = [q.get("mdContent_html") or "", q.get("analysisText_html") or ""]
            refs = [s for text in texts for s in re.findall(r'<img[^>]*src=[\x22\x27]([^\x22\x27]+)', text) if not s.startswith("data:")]
            if not all(texts) or refs:
                excluded.append(dict(year=year, number=number, reason="missing embedded answer illustration" if refs else "missing content", references=refs)); continue
            qid = f"github-408solution-{year}-{number}"
            tags = [int(t) for t in q["knowledgeTagsId"].split(",")]
            major = "数据结构" if max(tags) <= 44 else "计算机组成原理" if max(tags) <= 80 else "操作系统" if max(tags) <= 103 else "计算机网络"
            stem, answer = map(plain, texts)
            groups = {
                "数据结构": [("图与图算法", ["顶点", "最短路径", "有向图", "无向图"]), ("树与二叉树", ["二叉树", "二叉排序树", "树的", "叶结点"]), ("线性表", ["链表", "线性表"]), ("查找与排序", ["排序", "散列", "查找表"]), ("算法设计与复杂度", ["算法", "数组"])],
                "计算机组成原理": [("存储系统", ["Cache", "cache", "页表", "主存"]), ("指令系统与CPU", ["指令", "数据通路", "流水线"]), ("输入输出系统", ["DMA", "中断", "外设"]), ("数据表示与运算", ["补码", "浮点", "运算"])],
                "操作系统": [("进程同步与互斥", ["信号量", "wait", "互斥", "同步"]), ("内存管理", ["页表", "分页", "虚拟地址", "缺页"]), ("文件与磁盘管理", ["文件", "磁盘", "索引结点"]), ("进程与调度", ["进程", "调度"])],
                "计算机网络": [("网络层与IP编址", ["子网", "路由", "IP 地址", "IP地址"]), ("传输层", ["TCP", "拥塞", "UDP"]), ("数据链路层", ["滑动窗口", "以太网", "帧", "CSMA"]), ("网络性能分析", ["时延", "吞吐", "速率"])]
            }
            chapter = next((name for name, keys in groups[major] if any(key in stem for key in keys)), major + "综合应用")
            for kind, text in zip(("question", "analysis"), texts):
                (STAGING / (qid + "-" + kind + ".html")).write_text(text, encoding="utf-8")
            questions.append(dict(id=qid, type="solution", subject="计算机408", question_bank_id="bank-computer-408", stem_markdown=stem,
                options=[], answer_markdown=answer, analysis_markdown=answer + f"\n\n来源：kaichan-kc/408-questions · {year} 年第 {number} 题；原解答保留。",
                tags=[major, chapter], chapter=chapter, knowledge_points=[chapter], difficulty="medium", score=q["score"], review_status="approved",
                created_at=now, updated_at=now, source_document_id="source-github-408solution", source_page=1, source_question_number=number,
                analysis_source_document_id="source-github-408solution", previews={}, origin=dict(year=year, number=number,
                repository="https://github.com/kaichan-kc/408-questions", path=name.split("/",1)[1], knowledge_tag_ids=tags)))
    result = dict(version=1, ready=False, generated_at=now, counts=dict(Counter(q["tags"][0] for q in questions)),
        sources=[dict(id="408solution",repository="https://github.com/kaichan-kc/408-questions",archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest())],
        questions=questions, excluded=excluded)
    (DEST / "solutions408.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(dict(total=len(questions),counts=result["counts"],excluded=excluded),ensure_ascii=False))


if __name__ == "__main__": build()
