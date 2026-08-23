from __future__ import annotations

import re
from typing import Any

from .db import json_load, row_to_question


OPTION_KEYS = ("A", "B", "C", "D")


def normalize_options(values: list[str] | tuple[str, ...] | str) -> list[str]:
    if isinstance(values, str):
        values = list(values)
    result: list[str] = []
    for value in values:
        key = str(value).strip().upper().translate(str.maketrans("ＡＢＣＤ", "ABCD"))
        if key in OPTION_KEYS and key not in result:
            result.append(key)
    return sorted(result, key=OPTION_KEYS.index)


def answer_options(answer: str) -> list[str]:
    text = (answer or "").upper().translate(str.maketrans("ＡＢＣＤ", "ABCD"))
    match = re.search(r"(?:答案|正确答案|参考答案)\s*[:：]?\s*([ABCD]{1,4})", text)
    if match:
        return normalize_options(match.group(1))
    compact = re.sub(r"[^A-D]", "", text)
    if compact and len(compact) <= 4:
        return normalize_options(compact)
    match = re.search(r"\b([ABCD]{1,4})\b", text)
    return normalize_options(match.group(1)) if match else []


def is_correct(selected: list[str], correct: list[str]) -> bool:
    return bool(correct) and normalize_options(selected) == normalize_options(correct)


def question_answer_mode(answer: str) -> str:
    return "multiple" if len(answer_options(answer)) > 1 else "single"


def sanitize_practice_question(question: dict[str, Any]) -> dict[str, Any]:
    result = dict(question)
    result["answer_mode"] = question_answer_mode(question.get("answer_markdown", ""))
    result["answer_markdown"] = ""
    result["analysis_markdown"] = ""
    result.pop("source_regions", None)
    result.pop("analysis_regions", None)
    return result


def catalog_from_rows(rows: list[Any]) -> dict[str, Any]:
    subjects: dict[str, dict[str, Any]] = {}
    for row in rows:
        question = row_to_question(row)
        if question.get("type") != "choice" or not question.get("options"):
            continue
        if not answer_options(question.get("answer_markdown", "")):
            continue
        subject = question.get("subject") or "未分类"
        tags = question.get("tags") or []
        major = tags[0] if tags else "未分类"
        sub = tags[1] if len(tags) > 1 else ""
        subject_item = subjects.setdefault(
            subject,
            {
                "value": subject,
                "label": subject,
                "count": 0,
                "question_bank_id": row["question_bank_id"],
                "major_tags": {},
            },
        )
        subject_item["count"] += 1
        major_item = subject_item["major_tags"].setdefault(
            major,
            {"value": major, "label": major, "count": 0, "sub_tags": {}},
        )
        major_item["count"] += 1
        if sub:
            sub_item = major_item["sub_tags"].setdefault(
                sub,
                {"value": sub, "label": sub, "count": 0},
            )
            sub_item["count"] += 1

    result_subjects = []
    for subject in sorted(subjects.values(), key=lambda item: item["label"]):
        majors = []
        for major in sorted(subject["major_tags"].values(), key=lambda item: item["label"]):
            major["sub_tags"] = sorted(major["sub_tags"].values(), key=lambda item: item["label"])
            majors.append(major)
        subject["major_tags"] = majors
        result_subjects.append(subject)
    return {"subjects": result_subjects}


def practice_session_payload(
    session: Any,
    question_rows: list[Any],
    attempt_rows: list[Any],
) -> dict[str, Any]:
    attempts = {
        row["question_id"]: {
            "question_id": row["question_id"],
            "selected_options": normalize_options(row["selected_option"]),
            "correct_options": normalize_options(row["correct_option"]),
            "is_correct": bool(row["is_correct"]),
            "created_at": row["created_at"],
        }
        for row in attempt_rows
    }
    return {
        "id": session["id"],
        "subject": session["subject"],
        "major_tag": session["major_tag"],
        "sub_tag": session["sub_tag"],
        "total_count": session["total_count"],
        "answered_count": session["answered_count"],
        "completed": bool(session["completed_at"]),
        "created_at": session["created_at"],
        "completed_at": session["completed_at"],
        "wrong_question_ids": json_load(session["wrong_question_ids_json"], []),
        "questions": [
            {
                **sanitize_practice_question(row_to_question(row)),
                "attempt": attempts.get(row["id"]),
            }
            for row in question_rows
        ],
    }
