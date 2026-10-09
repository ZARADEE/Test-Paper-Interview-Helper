"""Built-in comprehensive template and optional 408 practice templates."""
import json
from fastapi import APIRouter
from .db import connect, utc_now, row_to_template

router = APIRouter(prefix="/api/template-presets")
SUBJECTS = [("数据结构", 11), ("计算机组成原理", 11), ("操作系统", 10), ("计算机网络", 8)]


def repair_legacy_presets(connection):
    """Recover only the exact positional-insert corruption from older schemas."""
    repaired = []
    ids = ["template-408-choice", "template-408-full", *[f"template-408-topic-{i}" for i in range(4)]]
    for template_id in ids:
        row = connection.execute("SELECT * FROM templates WHERE id=?", (template_id,)).fetchone()
        if row is None or row["duration_minutes"] != "bank-computer-408":
            continue
        try:
            sections = json.loads(row["distribution_rules_json"])
            rules = json.loads(row["version"])
            score = float(row["sections_json"])
            duration = int(row["total_score"])
        except (TypeError, ValueError):
            continue
        if not isinstance(sections, list) or not isinstance(rules, dict):
            continue
        connection.execute(
            "UPDATE templates SET question_bank_id=?,duration_minutes=?,total_score=?,sections_json=?,distribution_rules_json=?,version=1,created_at=?,updated_at=? WHERE id=?",
            ("bank-computer-408", duration, score, json.dumps(sections, ensure_ascii=False), json.dumps(rules, ensure_ascii=False), row["updated_at"], row["question_bank_id"], template_id),
        )
        repaired.append(template_id)
    return repaired


def ensure_408(connection, include_specialties=False):
    now, bank_id = utc_now(), "bank-computer-408"
    repair_legacy_presets(connection)
    connection.execute("INSERT OR IGNORE INTO question_banks(id,name,subject,description,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                       (bank_id, "计算机 408 题库", "计算机408", "408 四科题库，支持本地刷题和组卷。", now, now))
    choices = [{"id": f"choice-{i}", "title": name, "type": "choice", "count": count, "score": 2, "filters": {"tags": [name]}} for i, (name, count) in enumerate(SUBJECTS)]
    presets = [("template-408-choice", "408 四科选择题训练", 80, 75, choices)]
    for i, (name, _) in enumerate(SUBJECTS):
        presets.append((f"template-408-topic-{i}", f"408 · {name}专项", 20, 20,
                        [{"id": "choice", "title": name, "type": "choice", "count": 10, "score": 2, "filters": {"tags": [name]}}]))
    solutions = [{"id": f"solution-{i}", "title": f"{name}综合题 {i+1}", "type": "solution", "count": 1, "score": score, "filters": {"tags": [name]}} for i, (name, score) in enumerate([("数据结构", 15), ("计算机组成原理", 15), ("操作系统", 15), ("计算机网络", 10), ("数据结构", 15)])]
    presets.append(("template-408-full", "408 综合模拟卷（可调整）", 150, 180, choices + solutions))
    for id, name, score, duration, sections in presets:
        if not include_specialties and id != "template-408-full":
            continue
        connection.execute("INSERT OR IGNORE INTO templates(id,name,subject,question_bank_id,duration_minutes,total_score,sections_json,distribution_rules_json,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)",
                           (id, name, "计算机408", bank_id, duration, score, json.dumps(sections, ensure_ascii=False), json.dumps({"agent_enabled": False, "chapter_distribution": []}), now, now))
    return [row_to_template(row) for row in connection.execute("SELECT * FROM templates WHERE question_bank_id=? ORDER BY name", (bank_id,))]


@router.post("/408")
def install_408():
    with connect() as connection:
        return ensure_408(connection, include_specialties=True)
