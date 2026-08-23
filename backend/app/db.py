from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = ROOT / "data"
DOCUMENT_ROOT = DATA_ROOT / "documents"
QUESTION_ROOT = DATA_ROOT / "questions"
EXPORT_ROOT = DATA_ROOT / "exports"
DB_PATH = Path(os.getenv("PAPER_HELPER_DB_PATH", str(DATA_ROOT / "paper_helper.sqlite3")))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_dirs() -> None:
    for path in (DATA_ROOT, DOCUMENT_ROOT, QUESTION_ROOT, EXPORT_ROOT):
        path.mkdir(parents=True, exist_ok=True)


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    ensure_dirs()
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_db() -> None:
    ensure_dirs()
    with connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#ffd23f',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS source_documents (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                file_type TEXT NOT NULL,
                file_path TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                page_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'processed',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS questions (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                subject TEXT NOT NULL,
                stem_markdown TEXT NOT NULL,
                options_json TEXT NOT NULL DEFAULT '[]',
                answer_markdown TEXT NOT NULL DEFAULT '',
                analysis_markdown TEXT NOT NULL DEFAULT '',
                scoring_points_json TEXT NOT NULL DEFAULT '[]',
                tags_json TEXT NOT NULL DEFAULT '[]',
                chapter TEXT NOT NULL DEFAULT '',
                knowledge_points_json TEXT NOT NULL DEFAULT '[]',
                difficulty TEXT NOT NULL DEFAULT 'medium',
                score REAL NOT NULL DEFAULT 0,
                source_document_id TEXT,
                source_page INTEGER,
                review_status TEXT NOT NULL DEFAULT 'approved',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(source_document_id) REFERENCES source_documents(id)
            );

            CREATE TABLE IF NOT EXISTS review_items (
                id TEXT PRIMARY KEY,
                source_document_id TEXT,
                raw_text TEXT NOT NULL,
                parsed_question_json TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 0.5,
                status TEXT NOT NULL DEFAULT 'pending',
                review_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY(source_document_id) REFERENCES source_documents(id)
            );

            CREATE TABLE IF NOT EXISTS templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                subject TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL,
                total_score REAL NOT NULL,
                sections_json TEXT NOT NULL,
                distribution_rules_json TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS papers (
                id TEXT PRIMARY KEY,
                template_id TEXT NOT NULL,
                title TEXT NOT NULL,
                seed INTEGER NOT NULL,
                question_ids_json TEXT NOT NULL,
                validation_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(template_id) REFERENCES templates(id)
            );

            CREATE TABLE IF NOT EXISTS paper_questions (
                paper_id TEXT NOT NULL,
                question_id TEXT NOT NULL,
                section_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY(paper_id, question_id),
                FOREIGN KEY(paper_id) REFERENCES papers(id) ON DELETE CASCADE,
                FOREIGN KEY(question_id) REFERENCES questions(id)
            );

            CREATE TABLE IF NOT EXISTS export_jobs (
                id TEXT PRIMARY KEY,
                paper_id TEXT NOT NULL,
                format TEXT NOT NULL,
                variant TEXT NOT NULL,
                status TEXT NOT NULL,
                output_path TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(paper_id) REFERENCES papers(id)
            );
            """
        )
        question_columns = {row[1] for row in connection.execute("PRAGMA table_info(questions)").fetchall()}
        if "source_regions_json" not in question_columns:
            connection.execute(
                "ALTER TABLE questions ADD COLUMN source_regions_json TEXT NOT NULL DEFAULT '[]'"
            )
        if "analysis_source_document_id" not in question_columns:
            connection.execute(
                "ALTER TABLE questions ADD COLUMN analysis_source_document_id TEXT"
            )
        if "analysis_regions_json" not in question_columns:
            connection.execute(
                "ALTER TABLE questions ADD COLUMN analysis_regions_json TEXT NOT NULL DEFAULT '[]'"
            )
        seed_default_data(connection)


def seed_default_data(connection: sqlite3.Connection) -> None:
    tags = [
        ("tag-calculus", "高等数学", "#52d7ff"),
        ("tag-linear", "线性代数", "#b8a0ff"),
        ("tag-probability", "概率统计", "#35c96e"),
        ("tag-limit", "极限", "#ffd23f"),
        ("tag-integral", "积分", "#ff5a4f"),
    ]
    for tag in tags:
        connection.execute(
            "INSERT OR IGNORE INTO tags(id, name, color, created_at) VALUES(?, ?, ?, ?)",
            (*tag, utc_now()),
        )

    template_id = "template-math-one"
    existing_template = connection.execute("SELECT id FROM templates WHERE id = ?", (template_id,)).fetchone()
    if existing_template is None:
        sections = [
            {
                "id": "choice",
                "title": "一、选择题",
                "type": "choice",
                "count": 10,
                "score": 5,
                "filters": {},
            },
            {
                "id": "fill",
                "title": "二、填空题",
                "type": "fill",
                "count": 6,
                "score": 5,
                "filters": {},
            },
            {
                "id": "solution",
                "title": "三、解答题",
                "type": "solution",
                "count": 6,
                "score": 70 / 6,
                "filters": {},
            },
        ]
        rules = {
            "subject": "考研数学一",
            "chapter_distribution": [
                {"label": "高等数学", "ratio": 0.6, "tolerance": 0.08},
                {"label": "线性代数", "ratio": 0.2, "tolerance": 0.08},
                {"label": "概率论与数理统计", "ratio": 0.2, "tolerance": 0.08},
            ],
            "chapter_weights_note": "三大科目比例为初始约束；细分章节应根据导入真题统计结果继续校准。",
            "difficulty_distribution": [
                {"label": "easy", "ratio": 0.3, "tolerance": 0.15},
                {"label": "medium", "ratio": 0.5, "tolerance": 0.15},
                {"label": "hard", "ratio": 0.2, "tolerance": 0.15},
            ],
        }
        connection.execute(
            """
            INSERT INTO templates(
                id, name, subject, duration_minutes, total_score,
                sections_json, distribution_rules_json, version, created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                template_id,
                "考研数学一",
                "考研数学一",
                180,
                150,
                json.dumps(sections, ensure_ascii=False),
                json.dumps(rules, ensure_ascii=False),
                1,
                utc_now(),
                utc_now(),
            ),
        )

    question_count = connection.execute("SELECT COUNT(*) AS count FROM questions").fetchone()["count"]
    samples = [
        {
            "id": "demo-choice-001",
            "type": "choice",
            "subject": "考研数学一",
            "stem_markdown": "若 $f(x)=x^2+2x$，则 $f'(1)$ 等于（ ）。",
            "options": [{"key": "A", "text": "2"}, {"key": "B", "text": "4"}, {"key": "C", "text": "6"}, {"key": "D", "text": "8"}],
            "answer_markdown": "B",
            "analysis_markdown": "由 $f'(x)=2x+2$，所以 $f'(1)=4$。",
            "scoring_points": [],
            "tags": ["高等数学", "极限"],
            "chapter": "高等数学",
            "knowledge_points": ["导数"],
            "difficulty": "easy",
            "score": 5,
        },
        {
            "id": "demo-choice-002",
            "type": "choice",
            "subject": "考研数学一",
            "stem_markdown": "设矩阵 $A$ 可逆，则下列命题正确的是（ ）。",
            "options": [{"key": "A", "text": "det(A)=0"}, {"key": "B", "text": "rank(A)<n"}, {"key": "C", "text": "det(A)≠0"}, {"key": "D", "text": "A 必为对称矩阵"}],
            "answer_markdown": "C",
            "analysis_markdown": "可逆矩阵的行列式不为零。",
            "scoring_points": [],
            "tags": ["线性代数"],
            "chapter": "线性代数",
            "knowledge_points": ["矩阵"],
            "difficulty": "easy",
            "score": 5,
        },
        {
            "id": "demo-fill-001",
            "type": "fill",
            "subject": "考研数学一",
            "stem_markdown": "计算极限：$\\lim_{x\\to 0}\\frac{\\sin x}{x}=\\underline{\\quad}$。",
            "options": [],
            "answer_markdown": "1",
            "analysis_markdown": "这是三角函数的基本极限。",
            "scoring_points": [],
            "tags": ["高等数学", "极限"],
            "chapter": "高等数学",
            "knowledge_points": ["基本极限"],
            "difficulty": "easy",
            "score": 5,
        },
        {
            "id": "demo-fill-002",
            "type": "fill",
            "subject": "考研数学一",
            "stem_markdown": "若随机变量 $X\\sim N(0,1)$，则 $P(X\\leq 0)=\\underline{\\quad}$。",
            "options": [],
            "answer_markdown": "1/2",
            "analysis_markdown": "标准正态分布关于原点对称。",
            "scoring_points": [],
            "tags": ["概率统计"],
            "chapter": "概率论与数理统计",
            "knowledge_points": ["正态分布"],
            "difficulty": "medium",
            "score": 5,
        },
        {
            "id": "demo-solution-001",
            "type": "solution",
            "subject": "考研数学一",
            "stem_markdown": "求函数 $f(x)=x\\ln x$ 在 $x=1$ 处的切线方程，并讨论其单调性。",
            "options": [],
            "answer_markdown": "切线方程为 $y=x-1$。",
            "analysis_markdown": "先求 $f'(x)=\\ln x+1$，再代入 $x=1$。单调性由 $f'(x)$ 的符号确定。",
            "scoring_points": [{"label": "求导", "score": 2}, {"label": "切线方程", "score": 3}, {"label": "单调性讨论", "score": 5}],
            "tags": ["高等数学", "积分"],
            "chapter": "高等数学",
            "knowledge_points": ["导数应用"],
            "difficulty": "medium",
            "score": 10,
        },
        {
            "id": "demo-solution-002",
            "type": "solution",
            "subject": "考研数学一",
            "stem_markdown": "设 $A$ 为三阶矩阵，讨论参数 $a$ 取何值时方程组有唯一解。",
            "options": [],
            "answer_markdown": "当系数矩阵行列式不为零时有唯一解。",
            "analysis_markdown": "计算行列式并讨论其零点，再根据克拉默法则判断。",
            "scoring_points": [{"label": "计算行列式", "score": 4}, {"label": "参数讨论", "score": 4}],
            "tags": ["线性代数"],
            "chapter": "线性代数",
            "knowledge_points": ["方程组"],
            "difficulty": "hard",
            "score": 10,
        },
    ]
    if question_count == 0:
        for sample in samples:
            insert_demo_question(connection, sample)
    ensure_demo_question_pool(connection)


def insert_demo_question(connection: sqlite3.Connection, sample: dict[str, Any]) -> None:
    now = utc_now()
    connection.execute(
        """
        INSERT OR IGNORE INTO questions(
            id, type, subject, stem_markdown, options_json, answer_markdown,
            analysis_markdown, scoring_points_json, tags_json, chapter,
            knowledge_points_json, difficulty, score, review_status, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
        """,
        (
            sample["id"],
            sample["type"],
            sample["subject"],
            sample["stem_markdown"],
            json.dumps(sample["options"], ensure_ascii=False),
            sample["answer_markdown"],
            sample["analysis_markdown"],
            json.dumps(sample["scoring_points"], ensure_ascii=False),
            json.dumps(sample["tags"], ensure_ascii=False),
            sample["chapter"],
            json.dumps(sample["knowledge_points"], ensure_ascii=False),
            sample["difficulty"],
            sample["score"],
            now,
            now,
        ),
    )
    write_question_json({**sample, "review_status": "approved", "created_at": now, "updated_at": now}, now)


def ensure_demo_question_pool(connection: sqlite3.Connection) -> None:
    targets = {"choice": 10, "fill": 6, "solution": 6}
    seed_text = {
        "choice": (
            "若函数 f_{index}(x) 在定义域内满足连续性条件，则下列结论正确的是（ ）。",
            [{"key": "A", "text": "结论甲"}, {"key": "B", "text": "结论乙"}, {"key": "C", "text": "结论丙"}, {"key": "D", "text": "结论丁"}],
            "C",
            "连续函数的基本性质。",
            ["高等数学", "极限"],
            "高等数学",
            ["连续性"],
            5,
        ),
        "fill": (
            "计算表达式 f_{index}(0) 的值为 $\\underline{{\\quad}}$。",
            [],
            "1",
            "代入定义域内的指定点即可得到结果。",
            ["高等数学", "极限"],
            "高等数学",
            ["函数"],
            5,
        ),
        "solution": (
            "设函数 f_{index}(x) 满足题设条件，求其在给定区间上的性质并说明理由。",
            [],
            "根据题设条件逐步推导。",
            "先明确题设，再使用对应定理完成推导，并检查边界条件。",
            ["高等数学", "积分"],
            "高等数学",
            ["综合应用"],
            10,
        ),
    }
    for question_type, target in targets.items():
        current = connection.execute(
            "SELECT COUNT(*) AS count FROM questions WHERE type = ? AND subject = ?",
            (question_type, "考研数学一"),
        ).fetchone()["count"]
        for index in range(current + 1, target + 1):
            stem, options, answer, analysis, tags, chapter, knowledge_points, score = seed_text[question_type]
            sample = {
                "id": f"demo-{question_type}-{index:03d}",
                "type": question_type,
                "subject": "考研数学一",
                "stem_markdown": stem.format(index=index),
                "options": options,
                "answer_markdown": answer.format(index=index) if "{index}" in answer else answer,
                "analysis_markdown": analysis.format(index=index),
                "scoring_points": [{"label": "步骤完整", "score": score}],
                "tags": tags,
                "chapter": chapter,
                "knowledge_points": knowledge_points,
                "difficulty": ["easy", "medium", "hard"][index % 3],
                "score": score,
            }
            insert_demo_question(connection, sample)


def json_load(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def row_to_question(row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row)
    result["options"] = json_load(result.pop("options_json", "[]"), [])
    result["scoring_points"] = json_load(result.pop("scoring_points_json", "[]"), [])
    result["tags"] = json_load(result.pop("tags_json", "[]"), [])
    result["knowledge_points"] = json_load(result.pop("knowledge_points_json", "[]"), [])
    result["source_regions"] = json_load(result.pop("source_regions_json", "[]"), [])
    result["analysis_regions"] = json_load(result.pop("analysis_regions_json", "[]"), [])
    return result


def row_to_template(row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row)
    result["sections"] = json_load(result.pop("sections_json", "[]"), [])
    result["distribution_rules"] = json_load(result.pop("distribution_rules_json", "{}"), {})
    return result


def write_question_json(question: dict[str, Any], updated_at: str | None = None) -> None:
    ensure_dirs()
    payload = dict(question)
    payload["updated_at"] = updated_at or payload.get("updated_at") or utc_now()
    target = QUESTION_ROOT / f"{payload['id']}.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
