from __future__ import annotations

import json
import hashlib
import random
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from .composer import compose_paper, load_paper
from .db import (
    DOCUMENT_ROOT,
    MATH_ONE_BANK_ID,
    POLITICS_BANK_ID,
    QUESTION_ROOT,
    connect,
    init_db,
    json_load,
    row_to_question,
    row_to_template,
    utc_now,
    write_question_json,
)
from .exporters import export_paper, export_practice_pdf
from .extractors import extract_document, sha256_file, split_question_candidates
from .math_one import MAJOR_GROUPS, normalize_tag_pair
from .paired_pdf_import import render_source_preview
from .practice import (
    answer_options,
    catalog_from_rows,
    is_correct,
    normalize_options,
    practice_session_payload,
    sanitize_practice_question,
)


app = FastAPI(title="组卷助手 API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = "#ffd23f"
    question_bank_id: str | None = None


class QuestionBankCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    subject: str = Field(min_length=1, max_length=80)
    description: str = ""


class QuestionCreate(BaseModel):
    id: str | None = None
    type: str
    subject: str = "考研数学一"
    question_bank_id: str | None = None
    stem_markdown: str
    options: list[dict[str, str]] = []
    answer_markdown: str = ""
    analysis_markdown: str = ""
    scoring_points: list[dict[str, Any]] = []
    tags: list[str] = []
    chapter: str = ""
    knowledge_points: list[str] = []
    difficulty: str = "medium"
    score: float = 5
    source_page: int | None = None
    source_question_number: int | None = None
    source_regions: list[dict[str, Any]] = Field(default_factory=list)
    analysis_source_document_id: str | None = None
    analysis_regions: list[dict[str, Any]] = Field(default_factory=list)


class ReviewUpdate(BaseModel):
    parsed_question: QuestionCreate
    review_notes: str = ""


class TemplateCreate(BaseModel):
    name: str
    subject: str
    question_bank_id: str | None = None
    duration_minutes: int
    total_score: float
    sections: list[dict[str, Any]]
    distribution_rules: dict[str, Any] = {}


class ComposeRequest(BaseModel):
    template_id: str
    title: str = "未命名试卷"
    seed: int = 20260823
    locked_question_ids: list[str] = []
    required_tags: list[str] = []


class ExportRequest(BaseModel):
    format: str
    variant: str = "question"


class PracticeStartRequest(BaseModel):
    subject: str
    question_bank_id: str | None = None
    major_tag: str = ""
    sub_tag: str = ""
    count: int = Field(default=10, ge=1, le=100)
    seed: int | None = None


class PracticeAnswerRequest(BaseModel):
    question_id: str
    selected_options: list[str] = Field(default_factory=list)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, Any]:
    with connect() as connection:
        question_count = connection.execute("SELECT COUNT(*) AS count FROM questions").fetchone()["count"]
        template_count = connection.execute("SELECT COUNT(*) AS count FROM templates").fetchone()["count"]
    return {"ok": True, "service": "paper-helper", "question_count": question_count, "template_count": template_count}


@app.get("/api/question-banks")
def list_question_banks() -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM question_banks ORDER BY name, id"
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/question-banks")
def create_question_bank(payload: QuestionBankCreate) -> dict[str, Any]:
    bank_id = f"bank-{uuid.uuid4().hex[:10]}"
    now = utc_now()
    try:
        with connect() as connection:
            connection.execute(
                """
                INSERT INTO question_banks(id, name, subject, description, created_at, updated_at)
                VALUES(?, ?, ?, ?, ?, ?)
                """,
                (
                    bank_id,
                    payload.name.strip(),
                    payload.subject.strip(),
                    payload.description.strip(),
                    now,
                    now,
                ),
            )
            row = connection.execute(
                "SELECT * FROM question_banks WHERE id=?",
                (bank_id,),
            ).fetchone()
    except Exception as error:
        raise HTTPException(status_code=409, detail=f"题库名称已存在或无法创建：{error}") from error
    return dict(row)


def _default_bank_id(subject: str) -> str:
    if subject == "考研政治":
        return POLITICS_BANK_ID
    return MATH_ONE_BANK_ID


def _require_bank(connection: Any, bank_id: str | None, subject: str) -> Any:
    resolved_id = bank_id or _default_bank_id(subject)
    row = connection.execute(
        "SELECT * FROM question_banks WHERE id=?",
        (resolved_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="关联的题库不存在。")
    return row


@app.get("/api/tags")
def list_tags(question_bank_id: str | None = None) -> list[dict[str, Any]]:
    with connect() as connection:
        catalog = {
            row["name"]: dict(row)
            for row in connection.execute(
                """
                SELECT * FROM tags
                WHERE (? IS NULL OR question_bank_id = ?)
                ORDER BY name
                """,
                (question_bank_id, question_bank_id),
            ).fetchall()
        }
        if question_bank_id:
            question_rows = connection.execute(
                """
                SELECT tags_json, chapter, knowledge_points_json
                FROM questions
                WHERE question_bank_id=?
                """,
                (question_bank_id,),
            ).fetchall()
        else:
            question_rows = connection.execute(
                "SELECT tags_json, chapter, knowledge_points_json FROM questions"
            ).fetchall()
        for row in question_rows:
            names = normalize_tag_pair(
                json_load(row["tags_json"], []),
                row["chapter"],
                json_load(row["knowledge_points_json"], []),
            )
            for name in names:
                if not name:
                    continue
                if name in catalog:
                    continue
                tag_hash = hashlib.sha1(name.encode("utf-8")).hexdigest()[:10]
                color = "#52d7ff" if name in MAJOR_GROUPS else "#ffd23f"
                catalog[name] = {
                    "id": f"tag-catalog-{tag_hash}",
                    "name": name,
                    "color": color,
                    "created_at": "",
                }
        return sorted(catalog.values(), key=lambda item: item["name"])


@app.post("/api/tags")
def create_tag(payload: TagCreate) -> dict[str, Any]:
    tag_id = f"tag-{uuid.uuid4().hex[:10]}"
    try:
        with connect() as connection:
            _require_bank(connection, payload.question_bank_id, "")
            connection.execute(
                """
                INSERT INTO tags(id, name, question_bank_id, color, created_at)
                VALUES(?, ?, ?, ?, ?)
                """,
                (
                    tag_id,
                    payload.name.strip(),
                    payload.question_bank_id or MATH_ONE_BANK_ID,
                    payload.color,
                    utc_now(),
                ),
            )
            row = connection.execute("SELECT * FROM tags WHERE id = ?", (tag_id,)).fetchone()
            return dict(row)
    except Exception as error:
        raise HTTPException(status_code=409, detail=f"tag 已存在或无法创建：{error}") from error


@app.get("/api/questions")
def list_questions(
    subject: str | None = None,
    question_bank_id: str | None = None,
    question_type: str | None = None,
    status: str = "approved",
) -> list[dict[str, Any]]:
    clauses = ["review_status = ?"]
    values: list[Any] = [status]
    if subject:
        clauses.append("subject = ?")
        values.append(subject)
    if question_bank_id:
        clauses.append("question_bank_id = ?")
        values.append(question_bank_id)
    if question_type:
        clauses.append("type = ?")
        values.append(question_type)
    with connect() as connection:
        rows = connection.execute(
            f"SELECT * FROM questions WHERE {' AND '.join(clauses)} ORDER BY updated_at DESC",
            values,
        ).fetchall()
    return [row_to_question(row) for row in rows]


@app.post("/api/questions")
def create_question(payload: QuestionCreate) -> dict[str, Any]:
    question_id = payload.id or f"question-{uuid.uuid4().hex[:10]}"
    now = utc_now()
    data = payload.model_dump()
    data["id"] = question_id
    data["tags"] = normalize_tag_pair(data["tags"], data["chapter"], data["knowledge_points"])
    with connect() as connection:
        bank = _require_bank(connection, data.get("question_bank_id"), data["subject"])
        data["question_bank_id"] = bank["id"]
        connection.execute(
            """
            INSERT INTO questions(
                id, type, subject, question_bank_id, stem_markdown, options_json, answer_markdown,
                analysis_markdown, scoring_points_json, tags_json, chapter,
                knowledge_points_json, difficulty, score, source_regions_json,
                analysis_source_document_id, analysis_regions_json,
                review_status, created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
            """,
            (
                question_id,
                data["type"],
                data["subject"],
                data["question_bank_id"],
                data["stem_markdown"],
                json.dumps(data["options"], ensure_ascii=False),
                data["answer_markdown"],
                data["analysis_markdown"],
                json.dumps(data["scoring_points"], ensure_ascii=False),
                json.dumps(data["tags"], ensure_ascii=False),
                data["chapter"],
                json.dumps(data["knowledge_points"], ensure_ascii=False),
                data["difficulty"],
                data["score"],
                json.dumps(data["source_regions"], ensure_ascii=False),
                data["analysis_source_document_id"],
                json.dumps(data["analysis_regions"], ensure_ascii=False),
                now,
                now,
            ),
        )
    write_question_json({**data, "review_status": "approved", "created_at": now, "updated_at": now})
    return data


@app.patch("/api/questions/{question_id}")
def update_question(question_id: str, payload: QuestionCreate) -> dict[str, Any]:
    data = payload.model_dump()
    data["tags"] = normalize_tag_pair(data["tags"], data["chapter"], data["knowledge_points"])
    now = utc_now()
    with connect() as connection:
        existing = connection.execute("SELECT id FROM questions WHERE id = ?", (question_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="题目不存在。")
        bank = _require_bank(connection, data.get("question_bank_id"), data["subject"])
        data["question_bank_id"] = bank["id"]
        connection.execute(
            """
            UPDATE questions SET type=?, subject=?, stem_markdown=?, options_json=?,
                question_bank_id=?,
                answer_markdown=?, analysis_markdown=?, scoring_points_json=?, tags_json=?,
                chapter=?, knowledge_points_json=?, difficulty=?, score=?,
                source_regions_json=?, analysis_source_document_id=?, analysis_regions_json=?,
                updated_at=?
            WHERE id=?
            """,
            (
                data["type"],
                data["subject"],
                data["stem_markdown"],
                json.dumps(data["options"], ensure_ascii=False),
                data["question_bank_id"],
                data["answer_markdown"],
                data["analysis_markdown"],
                json.dumps(data["scoring_points"], ensure_ascii=False),
                json.dumps(data["tags"], ensure_ascii=False),
                data["chapter"],
                json.dumps(data["knowledge_points"], ensure_ascii=False),
                data["difficulty"],
                data["score"],
                json.dumps(data["source_regions"], ensure_ascii=False),
                data["analysis_source_document_id"],
                json.dumps(data["analysis_regions"], ensure_ascii=False),
                now,
                question_id,
            ),
        )
        row = connection.execute("SELECT * FROM questions WHERE id = ?", (question_id,)).fetchone()
    result = row_to_question(row)
    write_question_json(result)
    return result


@app.get("/api/questions/export-json")
def export_questions_json() -> dict[str, Any]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM questions ORDER BY question_bank_id, id").fetchall()
    return {"questions": [row_to_question(row) for row in rows]}


@app.get("/api/questions/{question_id}/preview")
def question_preview(question_id: str, kind: str = "question") -> Response:
    if kind not in {"question", "analysis"}:
        raise HTTPException(status_code=400, detail="预览类型不支持。")
    with connect() as connection:
        row = connection.execute("SELECT * FROM questions WHERE id = ?", (question_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="题目不存在。")
        source_document_id = (
            row["analysis_source_document_id"]
            if kind == "analysis"
            else row["source_document_id"]
        )
        regions = (
            json_load(row["analysis_regions_json"], [])
            if kind == "analysis"
            else json_load(row["source_regions_json"], [])
        )
        source = connection.execute(
            "SELECT file_path FROM source_documents WHERE id = ?",
            (source_document_id,),
        ).fetchone()
    if source is None or not source["file_path"]:
        raise HTTPException(status_code=404, detail="原始文档不存在。")
    path = Path(source["file_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="原始 PDF 文件已被移除。")
    try:
        content = render_source_preview(path, regions)
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return Response(content=content, media_type="image/png", headers={"Cache-Control": "no-store"})


@app.post("/api/questions/import-json")
def import_questions_json(payload: dict[str, Any]) -> dict[str, Any]:
    questions = payload.get("questions", [])
    imported = 0
    for raw in questions:
        question = QuestionCreate.model_validate(raw)
        create_question(question)
        imported += 1
    return {"ok": True, "imported": imported}


@app.post("/api/documents/import")
async def import_document(
    file: UploadFile = File(...),
    question_bank_id: str = Form(...),
) -> dict[str, Any]:
    original_name = file.filename or "untitled"
    suffix = Path(original_name).suffix.lower()
    if suffix not in {".pdf", ".docx", ".doc"}:
        raise HTTPException(status_code=400, detail="只支持 PDF、DOCX 和 DOC 文件。")
    document_id = f"doc-{uuid.uuid4().hex[:10]}"
    target = DOCUMENT_ROOT / f"{document_id}{suffix}"
    target.write_bytes(await file.read())
    try:
        pages = extract_document(target)
        candidates = split_question_candidates(pages)
    except Exception as error:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(error)) from error

    now = utc_now()
    with connect() as connection:
        bank = _require_bank(connection, question_bank_id, "")
        bank_id = bank["id"]
        connection.execute(
            """
            INSERT INTO source_documents(
                id, filename, file_type, file_path, sha256, page_count,
                question_bank_id, status, created_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, 'processed', ?)
            """,
            (
                document_id,
                original_name,
                suffix.lstrip("."),
                str(target),
                sha256_file(target),
                len(pages),
                bank_id,
                now,
            ),
        )
        review_ids = []
        for candidate in candidates:
            candidate["question_bank_id"] = bank_id
            candidate["subject"] = bank["subject"]
            review_id = f"review-{uuid.uuid4().hex[:10]}"
            review_ids.append(review_id)
            connection.execute(
                """
                INSERT INTO review_items(
                    id, source_document_id, question_bank_id, raw_text, parsed_question_json,
                    confidence, status, review_notes, created_at
                ) VALUES(?, ?, ?, ?, ?, ?, 'pending', '', ?)
                """,
                (
                    review_id,
                    document_id,
                    bank_id,
                    candidate["stem_markdown"],
                    json.dumps(candidate, ensure_ascii=False),
                    candidate.get("confidence", 0.5),
                    now,
                ),
            )
    return {
        "document_id": document_id,
        "filename": original_name,
        "page_count": len(pages),
        "candidate_count": len(candidates),
        "review_ids": review_ids,
    }


@app.get("/api/reviews")
def list_reviews(
    status: str = "pending",
    question_bank_id: str | None = None,
    page: int = 1,
    page_size: int = 12,
) -> dict[str, Any]:
    page = max(1, page)
    page_size = min(50, max(1, page_size))
    with connect() as connection:
        bank_clause = " AND question_bank_id = ?" if question_bank_id else ""
        status_values: list[Any] = [status]
        if question_bank_id:
            status_values.append(question_bank_id)
        total = connection.execute(
            f"SELECT COUNT(*) AS count FROM review_items WHERE status = ?{bank_clause}",
            status_values,
        ).fetchone()["count"]
        matched_values = list(status_values)
        matched_count = connection.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM review_items
            WHERE status = ?
              AND json_extract(parsed_question_json, '$.analysis_matched') = 1
              {bank_clause}
            """,
            matched_values,
        ).fetchone()["count"]
        page_values = list(status_values)
        page_values.extend([page_size, (page - 1) * page_size])
        rows = connection.execute(
            f"""
            SELECT * FROM review_items
            WHERE status = ?
              {bank_clause}
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            page_values,
        ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["parsed_question"] = json_load(item.pop("parsed_question_json"), {})
        result.append(item)
    pages = max(1, (total + page_size - 1) // page_size)
    return {
        "items": result,
        "page": min(page, pages),
        "page_size": page_size,
        "total": total,
        "pages": pages,
        "matched_count": matched_count,
        "unmatched_count": total - matched_count,
    }


def _approve_review_row(connection: Any, row: Any) -> dict[str, Any]:
    parsed_question = json_load(row["parsed_question_json"], {})
    payload = QuestionCreate.model_validate(parsed_question)
    question_id = f"question-{uuid.uuid4().hex[:10]}"
    now = utc_now()
    data = payload.model_dump()
    data["tags"] = normalize_tag_pair(data["tags"], data["chapter"], data["knowledge_points"])
    data["question_bank_id"] = row["question_bank_id"] or data.get("question_bank_id")
    bank = _require_bank(connection, data["question_bank_id"], data["subject"])
    data["question_bank_id"] = bank["id"]
    connection.execute(
        """
        INSERT INTO questions(
            id, type, subject, question_bank_id, stem_markdown, options_json, answer_markdown,
            analysis_markdown, scoring_points_json, tags_json, chapter,
            knowledge_points_json, difficulty, score, source_document_id,
            source_page, source_regions_json, analysis_source_document_id,
            analysis_regions_json, review_status, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
        """,
        (
            question_id,
            data["type"],
            data["subject"],
            data["question_bank_id"],
            data["stem_markdown"],
            json.dumps(data["options"], ensure_ascii=False),
            data["answer_markdown"],
            data["analysis_markdown"],
            json.dumps(data["scoring_points"], ensure_ascii=False),
            json.dumps(data["tags"], ensure_ascii=False),
            data["chapter"],
            json.dumps(data["knowledge_points"], ensure_ascii=False),
            data["difficulty"],
            data["score"],
            row["source_document_id"],
            data.get("source_page"),
            json.dumps(data["source_regions"], ensure_ascii=False),
            data["analysis_source_document_id"],
            json.dumps(data["analysis_regions"], ensure_ascii=False),
            now,
            now,
        ),
    )
    connection.execute("UPDATE review_items SET status='approved' WHERE id=?", (row["id"],))
    result_row = connection.execute("SELECT * FROM questions WHERE id=?", (question_id,)).fetchone()
    return row_to_question(result_row)


@app.post("/api/reviews/batch-approve")
def approve_matched_reviews(question_bank_id: str | None = None) -> dict[str, Any]:
    approved: list[dict[str, Any]] = []
    skipped = 0
    with connect() as connection:
        bank_clause = " AND question_bank_id = ?" if question_bank_id else ""
        values: tuple[Any, ...] = ("pending", question_bank_id) if question_bank_id else ("pending",)
        rows = connection.execute(
            f"SELECT * FROM review_items WHERE status = ?{bank_clause} ORDER BY created_at, id",
            values,
        ).fetchall()
        for row in rows:
            parsed = json_load(row["parsed_question_json"], {})
            if not parsed.get("analysis_matched"):
                skipped += 1
                continue
            approved.append(_approve_review_row(connection, row))
    for question in approved:
        write_question_json(question)
    return {
        "approved": len(approved),
        "skipped_without_matched_analysis": skipped,
    }


@app.delete("/api/reviews/unmatched")
def delete_unmatched_reviews(question_bank_id: str | None = None) -> dict[str, Any]:
    with connect() as connection:
        bank_clause = " AND question_bank_id = ?" if question_bank_id else ""
        values: tuple[Any, ...] = (question_bank_id,) if question_bank_id else ()
        cursor = connection.execute(
            f"""
            DELETE FROM review_items
            WHERE status = 'pending'
              AND coalesce(json_extract(parsed_question_json, '$.analysis_matched'), 0) = 0
              {bank_clause}
            """,
            values,
        )
        return {"deleted": cursor.rowcount}


@app.delete("/api/reviews/{review_id}")
def delete_review(review_id: str) -> dict[str, Any]:
    with connect() as connection:
        existing = connection.execute(
            "SELECT id FROM review_items WHERE id = ?",
            (review_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="审核项不存在。")
        connection.execute("DELETE FROM review_items WHERE id = ?", (review_id,))
    return {"ok": True, "id": review_id}


@app.get("/api/reviews/{review_id}/preview")
def review_preview(review_id: str, kind: str = "question") -> Response:
    if kind not in {"question", "analysis"}:
        raise HTTPException(status_code=400, detail="预览类型不支持。")
    with connect() as connection:
        row = connection.execute("SELECT * FROM review_items WHERE id = ?", (review_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="审核项不存在。")
        parsed = json_load(row["parsed_question_json"], {})
        source_document_id = (
            parsed.get("analysis_source_document_id")
            if kind == "analysis"
            else row["source_document_id"]
        )
        regions = parsed.get("analysis_regions", []) if kind == "analysis" else parsed.get("source_regions", [])
        source = connection.execute(
            "SELECT file_path FROM source_documents WHERE id = ?",
            (source_document_id,),
        ).fetchone()
    if source is None or not source["file_path"]:
        raise HTTPException(status_code=404, detail="原始文档不存在。")
    path = Path(source["file_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="原始 PDF 文件已被移除。")
    try:
        content = render_source_preview(path, regions)
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return Response(content=content, media_type="image/png", headers={"Cache-Control": "no-store"})


@app.patch("/api/reviews/{review_id}")
def update_review(review_id: str, payload: ReviewUpdate) -> dict[str, Any]:
    parsed_question = payload.parsed_question.model_dump()
    parsed_question["tags"] = normalize_tag_pair(
        parsed_question["tags"],
        parsed_question["chapter"],
        parsed_question["knowledge_points"],
    )
    with connect() as connection:
        existing = connection.execute(
            "SELECT id, question_bank_id FROM review_items WHERE id = ?",
            (review_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="审核项不存在。")
        parsed_question["question_bank_id"] = (
            existing["question_bank_id"] or parsed_question.get("question_bank_id")
        )
        connection.execute(
            "UPDATE review_items SET parsed_question_json=?, raw_text=?, review_notes=? WHERE id=?",
            (
                json.dumps(parsed_question, ensure_ascii=False),
                parsed_question["stem_markdown"],
                payload.review_notes,
                review_id,
            ),
        )
    return {"ok": True, "id": review_id}


@app.post("/api/reviews/{review_id}/approve")
def approve_review(review_id: str) -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute("SELECT * FROM review_items WHERE id = ?", (review_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="审核项不存在。")
        result = _approve_review_row(connection, row)
    write_question_json(result)
    return result


def _practice_question_rows(
    connection: Any,
    subject: str,
    question_bank_id: str,
    major_tag: str = "",
    sub_tag: str = "",
) -> list[Any]:
    rows = connection.execute(
        """
        SELECT * FROM questions
        WHERE review_status = 'approved'
          AND subject = ?
          AND question_bank_id = ?
          AND type = 'choice'
        ORDER BY id
        """,
        (subject, question_bank_id),
    ).fetchall()
    candidates = []
    for row in rows:
        question = row_to_question(row)
        tags = question.get("tags", [])
        if not question.get("options") or not answer_options(question.get("answer_markdown", "")):
            continue
        if major_tag and (not tags or tags[0] != major_tag):
            continue
        if sub_tag and (len(tags) < 2 or tags[1] != sub_tag):
            continue
        candidates.append(row)
    return candidates


def _get_practice_session(connection: Any, session_id: str) -> Any:
    row = connection.execute(
        "SELECT * FROM practice_sessions WHERE id = ?",
        (session_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="刷题记录不存在。")
    return row


@app.get("/api/practice/catalog")
def practice_catalog() -> dict[str, Any]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT * FROM questions
            WHERE review_status='approved'
              AND type='choice'
              AND question_bank_id IS NOT NULL
            """
        ).fetchall()
        wrong_count = connection.execute(
            "SELECT COUNT(*) AS count FROM wrong_questions"
        ).fetchone()["count"]
    result = catalog_from_rows(rows)
    result["wrong_book_count"] = wrong_count
    return result


@app.post("/api/practice/sessions")
def start_practice(payload: PracticeStartRequest) -> dict[str, Any]:
    with connect() as connection:
        bank = _require_bank(connection, payload.question_bank_id, payload.subject)
        candidates = _practice_question_rows(
            connection,
            payload.subject,
            bank["id"],
            payload.major_tag.strip(),
            payload.sub_tag.strip(),
        )
        if not candidates:
            raise HTTPException(status_code=404, detail="当前筛选条件下没有可刷的选择题。")
        rng = random.Random(payload.seed if payload.seed is not None else random.SystemRandom().randint(0, 2**31 - 1))
        selected_rows = rng.sample(candidates, min(payload.count, len(candidates)))
        session_id = f"practice-{uuid.uuid4().hex[:12]}"
        now = utc_now()
        question_ids = [row["id"] for row in selected_rows]
        connection.execute(
            """
            INSERT INTO practice_sessions(
                id, subject, question_bank_id, major_tag, sub_tag, total_count,
                answered_count, question_ids_json, wrong_question_ids_json, created_at
            ) VALUES(?, ?, ?, ?, ?, ?, 0, ?, '[]', ?)
            """,
            (
                session_id,
                payload.subject,
                bank["id"],
                payload.major_tag.strip(),
                payload.sub_tag.strip(),
                len(question_ids),
                json.dumps(question_ids, ensure_ascii=False),
                now,
            ),
        )
        session = connection.execute(
            "SELECT * FROM practice_sessions WHERE id=?",
            (session_id,),
        ).fetchone()
    return practice_session_payload(session, selected_rows, [])


@app.get("/api/practice/sessions/{session_id}")
def get_practice_session(session_id: str) -> dict[str, Any]:
    with connect() as connection:
        session = _get_practice_session(connection, session_id)
        question_ids = json_load(session["question_ids_json"], [])
        rows = []
        if question_ids:
            placeholders = ",".join("?" for _ in question_ids)
            found = connection.execute(
                f"SELECT * FROM questions WHERE id IN ({placeholders})",
                question_ids,
            ).fetchall()
            by_id = {row["id"]: row for row in found}
            rows = [by_id[item] for item in question_ids if item in by_id]
        attempts = connection.execute(
            "SELECT * FROM practice_attempts WHERE session_id=?",
            (session_id,),
        ).fetchall()
    return practice_session_payload(session, rows, attempts)


@app.post("/api/practice/sessions/{session_id}/answer")
def answer_practice_question(
    session_id: str,
    payload: PracticeAnswerRequest,
) -> dict[str, Any]:
    selected = normalize_options(payload.selected_options)
    if not selected:
        raise HTTPException(status_code=400, detail="至少选择一个选项。")
    with connect() as connection:
        session = _get_practice_session(connection, session_id)
        question_ids = json_load(session["question_ids_json"], [])
        if payload.question_id not in question_ids:
            raise HTTPException(status_code=400, detail="题目不属于当前刷题记录。")
        existing_attempt = connection.execute(
            "SELECT id FROM practice_attempts WHERE session_id=? AND question_id=?",
            (session_id, payload.question_id),
        ).fetchone()
        if existing_attempt is not None:
            raise HTTPException(status_code=409, detail="本题已经提交过答案。")
        row = connection.execute(
            "SELECT * FROM questions WHERE id=?",
            (payload.question_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="题目不存在。")
        question = row_to_question(row)
        correct = answer_options(question.get("answer_markdown", ""))
        result = is_correct(selected, correct)
        now = utc_now()
        connection.execute(
            """
            INSERT INTO practice_attempts(
                id, session_id, question_id, selected_option,
                correct_option, is_correct, created_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"attempt-{uuid.uuid4().hex[:12]}",
                session_id,
                payload.question_id,
                "".join(selected),
                "".join(correct),
                int(result),
                now,
            ),
        )
        if not result:
            connection.execute(
                """
                INSERT INTO wrong_questions(
                    question_id, subject, first_wrong_at, last_wrong_at,
                    wrong_count, last_selected_option, last_correct_option
                ) VALUES(?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(question_id) DO UPDATE SET
                    last_wrong_at=excluded.last_wrong_at,
                    wrong_count=wrong_questions.wrong_count + 1,
                    last_selected_option=excluded.last_selected_option,
                    last_correct_option=excluded.last_correct_option
                """,
                (
                    payload.question_id,
                    question.get("subject", ""),
                    now,
                    now,
                    "".join(selected),
                    "".join(correct),
                ),
            )
        wrong_ids = json_load(session["wrong_question_ids_json"], [])
        if not result and payload.question_id not in wrong_ids:
            wrong_ids.append(payload.question_id)
        answered_count = connection.execute(
            "SELECT COUNT(*) AS count FROM practice_attempts WHERE session_id=?",
            (session_id,),
        ).fetchone()["count"]
        completed_at = now if answered_count >= session["total_count"] else session["completed_at"]
        connection.execute(
            """
            UPDATE practice_sessions
            SET answered_count=?, wrong_question_ids_json=?, completed_at=?
            WHERE id=?
            """,
            (
                answered_count,
                json.dumps(wrong_ids, ensure_ascii=False),
                completed_at,
                session_id,
            ),
        )
    return {
        "question_id": payload.question_id,
        "selected_options": selected,
        "correct_options": correct,
        "correct": result,
        "question": question,
        "answered_count": answered_count,
        "total_count": session["total_count"],
        "wrong_question_ids": wrong_ids,
    }


@app.get("/api/practice/wrong-book")
def list_wrong_book(
    subject: str | None = None,
    major_tag: str | None = None,
    sub_tag: str | None = None,
) -> dict[str, Any]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT w.*, q.*
            FROM wrong_questions w
            JOIN questions q ON q.id=w.question_id
            ORDER BY w.last_wrong_at DESC
            """
        ).fetchall()
    items = []
    for row in rows:
        question = row_to_question(row)
        tags = question.get("tags", [])
        if subject and question.get("subject") != subject:
            continue
        if major_tag and (not tags or tags[0] != major_tag):
            continue
        if sub_tag and (len(tags) < 2 or tags[1] != sub_tag):
            continue
        item = {
            **question,
            "wrong_count": row["wrong_count"],
            "first_wrong_at": row["first_wrong_at"],
            "last_wrong_at": row["last_wrong_at"],
            "last_selected_option": normalize_options(row["last_selected_option"]),
            "last_correct_option": normalize_options(row["last_correct_option"]),
        }
        items.append(item)
    return {"items": items, "count": len(items)}


@app.delete("/api/practice/wrong-book/{question_id}")
def delete_wrong_book_item(question_id: str) -> dict[str, Any]:
    with connect() as connection:
        existing = connection.execute(
            "SELECT question_id FROM wrong_questions WHERE question_id=?",
            (question_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="错题本中不存在这道题。")
        connection.execute(
            "DELETE FROM wrong_questions WHERE question_id=?",
            (question_id,),
        )
    return {"ok": True, "question_id": question_id}


@app.post("/api/practice/sessions/{session_id}/export")
def export_practice_session(session_id: str) -> dict[str, Any]:
    with connect() as connection:
        session_row = _get_practice_session(connection, session_id)
        wrong_ids = json_load(session_row["wrong_question_ids_json"], [])
        if not wrong_ids:
            raise HTTPException(status_code=400, detail="本次刷题还没有错题，暂时不能导出。")
        placeholders = ",".join("?" for _ in wrong_ids)
        question_rows = connection.execute(
            f"SELECT * FROM questions WHERE id IN ({placeholders})",
            wrong_ids,
        ).fetchall()
        attempts = connection.execute(
            """
            SELECT * FROM practice_attempts
            WHERE session_id=? AND question_id IN ({})
            """.format(placeholders),
            [session_id, *wrong_ids],
        ).fetchall()
    attempts_by_id = {row["question_id"]: row for row in attempts}
    question_by_id = {row["id"]: row for row in question_rows}
    wrong_items = []
    for question_id in wrong_ids:
        row = question_by_id.get(question_id)
        attempt = attempts_by_id.get(question_id)
        if row is None or attempt is None:
            continue
        wrong_items.append(
            {
                "question": row_to_question(row),
                "attempt": {
                    "selected_options": normalize_options(attempt["selected_option"]),
                    "correct_options": normalize_options(attempt["correct_option"]),
                },
            }
        )
    if not wrong_items:
        raise HTTPException(status_code=400, detail="没有可导出的错题。")
    job_id = f"practice-export-{uuid.uuid4().hex[:10]}"
    target = Path(__file__).resolve().parents[1] / "data" / "exports" / f"{job_id}.pdf"
    session = dict(session_row)
    try:
        export_practice_pdf(session, wrong_items, target)
        with connect() as connection:
            connection.execute(
                """
                INSERT INTO practice_export_jobs(
                    id, session_id, format, status, output_path, created_at
                ) VALUES(?, ?, 'pdf', 'completed', ?, ?)
                """,
                (job_id, session_id, str(target), utc_now()),
            )
        return {"id": job_id, "status": "completed", "format": "pdf", "path": str(target)}
    except Exception as error:
        with connect() as connection:
            connection.execute(
                """
                INSERT INTO practice_export_jobs(
                    id, session_id, format, status, error, created_at
                ) VALUES(?, ?, 'pdf', 'failed', ?, ?)
                """,
                (job_id, session_id, str(error), utc_now()),
            )
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.get("/api/practice/exports/{job_id}/download")
def download_practice_export(job_id: str) -> FileResponse:
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM practice_export_jobs WHERE id=?",
            (job_id,),
        ).fetchone()
    if row is None or row["status"] != "completed" or not row["output_path"]:
        raise HTTPException(status_code=404, detail="刷题导出文件不存在。")
    path = Path(row["output_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="刷题导出文件已被移除。")
    return FileResponse(path, filename=path.name)


@app.get("/api/templates")
def list_templates() -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM templates ORDER BY name").fetchall()
    return [row_to_template(row) for row in rows]


@app.post("/api/templates")
def create_template(payload: TemplateCreate) -> dict[str, Any]:
    template_id = f"template-{uuid.uuid4().hex[:10]}"
    now = utc_now()
    with connect() as connection:
        bank = _require_bank(connection, payload.question_bank_id, payload.subject)
        connection.execute(
            """
            INSERT INTO templates(
                id, name, subject, question_bank_id, duration_minutes, total_score, sections_json,
                distribution_rules_json, version, created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                template_id,
                payload.name,
                payload.subject,
                bank["id"],
                payload.duration_minutes,
                payload.total_score,
                json.dumps(payload.sections, ensure_ascii=False),
                json.dumps(payload.distribution_rules, ensure_ascii=False),
                now,
                now,
            ),
        )
        row = connection.execute("SELECT * FROM templates WHERE id=?", (template_id,)).fetchone()
    return row_to_template(row)


@app.patch("/api/templates/{template_id}")
def update_template(template_id: str, payload: TemplateCreate) -> dict[str, Any]:
    now = utc_now()
    with connect() as connection:
        existing = connection.execute("SELECT id, version FROM templates WHERE id=?", (template_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="模板不存在。")
        bank = _require_bank(connection, payload.question_bank_id, payload.subject)
        connection.execute(
            """
            UPDATE templates SET name=?, subject=?, question_bank_id=?, duration_minutes=?, total_score=?,
                sections_json=?, distribution_rules_json=?, version=?, updated_at=?
            WHERE id=?
            """,
            (
                payload.name,
                payload.subject,
                bank["id"],
                payload.duration_minutes,
                payload.total_score,
                json.dumps(payload.sections, ensure_ascii=False),
                json.dumps(payload.distribution_rules, ensure_ascii=False),
                existing["version"] + 1,
                now,
                template_id,
            ),
        )
        row = connection.execute("SELECT * FROM templates WHERE id=?", (template_id,)).fetchone()
    return row_to_template(row)


@app.post("/api/templates/{template_id}/validate")
def validate_template(template_id: str) -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute("SELECT * FROM templates WHERE id=?", (template_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="模板不存在。")
        template = row_to_template(row)
    errors = []
    section_total = sum(float(item.get("score", 0)) * int(item.get("count", 0)) for item in template["sections"])
    if abs(section_total - float(template["total_score"])) > 0.01:
        errors.append(f"分区分值合计为 {section_total:g}，与模板总分 {template['total_score']:g} 不一致。")
    if not template["sections"]:
        errors.append("模板至少需要一个题型分区。")
    distribution = template.get("distribution_rules", {}).get("chapter_distribution", [])
    ratio_total = sum(max(0.0, float(item.get("ratio", 0))) for item in distribution)
    if not distribution:
        errors.append("模板至少需要配置一个科目占比。")
    elif abs(ratio_total - 1) > 0.001:
        errors.append(f"科目占比合计为 {ratio_total * 100:g}%，需要调整为 100%。")
    return {"valid": not errors, "errors": errors, "template_id": template_id}


@app.post("/api/papers/compose")
def compose(payload: ComposeRequest) -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute("SELECT * FROM templates WHERE id=?", (payload.template_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="模板不存在。")
        template = row_to_template(row)
        return compose_paper(
            connection,
            template,
            payload.seed,
            payload.title,
            payload.locked_question_ids,
            payload.required_tags,
        )


@app.get("/api/papers/{paper_id}")
def get_paper(paper_id: str) -> dict[str, Any]:
    with connect() as connection:
        paper = load_paper(connection, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="试卷不存在。")
    return paper


@app.post("/api/papers/{paper_id}/export")
def export_paper_file(paper_id: str, payload: ExportRequest) -> dict[str, Any]:
    if payload.format not in {"pdf", "docx"} or payload.variant not in {"question", "answer"}:
        raise HTTPException(status_code=400, detail="导出格式或版本不支持。")
    with connect() as connection:
        paper = load_paper(connection, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="试卷不存在。")
    job_id = f"export-{uuid.uuid4().hex[:10]}"
    try:
        output_path = export_paper(paper, payload.format, payload.variant)
        with connect() as connection:
            connection.execute(
                """
                INSERT INTO export_jobs(id, paper_id, format, variant, status, output_path, created_at)
                VALUES(?, ?, ?, ?, 'completed', ?, ?)
                """,
                (job_id, paper_id, payload.format, payload.variant, str(output_path), utc_now()),
            )
        return {"id": job_id, "status": "completed", "format": payload.format, "variant": payload.variant, "path": str(output_path)}
    except Exception as error:
        with connect() as connection:
            connection.execute(
                """
                INSERT INTO export_jobs(id, paper_id, format, variant, status, error, created_at)
                VALUES(?, ?, ?, ?, 'failed', ?, ?)
                """,
                (job_id, paper_id, payload.format, payload.variant, str(error), utc_now()),
            )
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.get("/api/exports/{job_id}/download")
def download_export(job_id: str) -> FileResponse:
    with connect() as connection:
        row = connection.execute("SELECT * FROM export_jobs WHERE id=?", (job_id,)).fetchone()
    if row is None or row["status"] != "completed" or not row["output_path"]:
        raise HTTPException(status_code=404, detail="导出文件不存在。")
    path = Path(row["output_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="导出文件已被移除。")
    return FileResponse(path, filename=path.name)
