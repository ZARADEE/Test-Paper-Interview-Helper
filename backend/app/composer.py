from __future__ import annotations

import hashlib
import json
import sqlite3
from typing import Any

from .db import row_to_question, row_to_template, utc_now
from .math_one import MAJOR_GROUPS, chapter_group


def deterministic_key(seed: int, question_id: str) -> str:
    return hashlib.sha256(f"{seed}:{question_id}".encode("utf-8")).hexdigest()


def distribution_targets(total: int, rules: list[dict[str, Any]]) -> dict[str, int]:
    if not rules:
        return {}
    raw = [(str(rule.get("label", "")), max(0.0, float(rule.get("ratio", 0)))) for rule in rules]
    ratio_total = sum(ratio for _, ratio in raw)
    if ratio_total <= 0:
        return {}
    normalized = [(label, ratio / ratio_total) for label, ratio in raw]
    targets = {label: int(total * ratio) for label, ratio in normalized}
    remainder = total - sum(targets.values())
    for label, _ in sorted(normalized, key=lambda item: item[1], reverse=True)[:remainder]:
        targets[label] += 1
    return targets


def compose_paper(
    connection: sqlite3.Connection,
    template: dict[str, Any],
    seed: int,
    title: str,
    locked_question_ids: list[str] | None = None,
    required_tags: list[str] | None = None,
) -> dict[str, Any]:
    locked = set(locked_question_ids or [])
    required = set(required_tags or [])
    rows = connection.execute(
        "SELECT * FROM questions WHERE review_status = 'approved' AND subject = ?",
        (template["subject"],),
    ).fetchall()
    questions = [row_to_question(row) for row in rows]
    selected_ids: set[str] = set()
    selected: list[dict[str, Any]] = []
    sections_result: list[dict[str, Any]] = []
    errors: list[str] = []
    chapter_rules = template.get("distribution_rules", {}).get("chapter_distribution", [])
    chapter_targets = distribution_targets(
        sum(int(section.get("count", 0)) for section in template["sections"]),
        chapter_rules,
    )
    chapter_counts = {group: 0 for group in MAJOR_GROUPS}

    for section in template["sections"]:
        section_type = section.get("type", "solution")
        count = int(section.get("count", 0))
        score = float(section.get("score", 0))
        candidates = [
            item
            for item in questions
            if item["type"] == section_type
            and (not required or required.issubset(set(item["tags"])))
            and item["id"] not in selected_ids
        ]
        candidates.sort(
            key=lambda item: (
                0 if item.get("source_regions") else 1,
                0
                if chapter_counts.get(chapter_group(item.get("chapter"), item.get("tags")), 0)
                < chapter_targets.get(chapter_group(item.get("chapter"), item.get("tags")), 0)
                else 1,
                deterministic_key(seed, item["id"]),
            )
        )
        locked_for_section = [
            item for item in questions if item["id"] in locked and item["type"] == section_type
        ]
        section_questions = locked_for_section[:count]
        selected_ids.update(item["id"] for item in section_questions)
        for item in section_questions:
            group = chapter_group(item.get("chapter"), item.get("tags"))
            chapter_counts[group] = chapter_counts.get(group, 0) + 1

        for item in candidates:
            if len(section_questions) >= count:
                break
            if item["id"] in selected_ids:
                continue
            section_questions.append(item)
            selected_ids.add(item["id"])
            group = chapter_group(item.get("chapter"), item.get("tags"))
            chapter_counts[group] = chapter_counts.get(group, 0) + 1

        if len(section_questions) < count:
            errors.append(
                f"{section.get('title', section_type)} 需要 {count} 道题，当前符合条件的题目只有 {len(section_questions)} 道。"
            )

        for position, item in enumerate(section_questions, start=1):
            selected.append(
                {
                    **item,
                    "section_id": section.get("id", section_type),
                    "section_title": section.get("title", section_type),
                    "position": position,
                    "allocated_score": score,
                }
            )
        sections_result.append(
            {
                "id": section.get("id", section_type),
                "title": section.get("title", section_type),
                "type": section_type,
                "requested_count": count,
                "selected_count": len(section_questions),
                "score": score,
            }
        )

    validation = {
        "valid": not errors,
        "errors": errors,
        "selected_count": len(selected),
        "total_score": sum(item["allocated_score"] for item in selected),
    }
    paper_id = f"paper-{seed}-{hashlib.sha256(title.encode('utf-8')).hexdigest()[:8]}"
    question_ids = [item["id"] for item in selected]
    connection.execute(
        """
        INSERT OR REPLACE INTO papers(
            id, template_id, title, seed, question_ids_json, validation_json, created_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?)
        """,
        (
            paper_id,
            template["id"],
            title,
            seed,
            json.dumps(question_ids, ensure_ascii=False),
            json.dumps(validation, ensure_ascii=False),
            utc_now(),
        ),
    )
    connection.execute("DELETE FROM paper_questions WHERE paper_id = ?", (paper_id,))
    for item in selected:
        connection.execute(
            """
            INSERT INTO paper_questions(paper_id, question_id, section_id, position)
            VALUES(?, ?, ?, ?)
            """,
            (paper_id, item["id"], item["section_id"], item["position"]),
        )

    return {
        "id": paper_id,
        "template_id": template["id"],
        "title": title,
        "seed": seed,
        "sections": sections_result,
        "questions": selected,
        "validation": validation,
        "created_at": utc_now(),
    }


def load_paper(connection: sqlite3.Connection, paper_id: str) -> dict[str, Any] | None:
    paper_row = connection.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
    if paper_row is None:
        return None
    paper = dict(paper_row)
    paper["question_ids"] = json.loads(paper.pop("question_ids_json"))
    paper["validation"] = json.loads(paper.pop("validation_json"))
    template_row = connection.execute("SELECT * FROM templates WHERE id = ?", (paper["template_id"],)).fetchone()
    template = row_to_template(template_row) if template_row else None
    paper["template"] = template
    rows = connection.execute(
        """
        SELECT q.*, pq.section_id, pq.position
        FROM paper_questions pq
        JOIN questions q ON q.id = pq.question_id
        WHERE pq.paper_id = ?
        ORDER BY pq.section_id, pq.position
        """,
        (paper_id,),
    ).fetchall()
    paper["questions"] = [row_to_question(row) for row in rows]
    return paper
