from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from .composer import compose_paper, load_paper
from .db import (
    DOCUMENT_ROOT,
    QUESTION_ROOT,
    connect,
    init_db,
    json_load,
    row_to_question,
    row_to_template,
    utc_now,
    write_question_json,
)
from .exporters import export_paper
from .extractors import extract_document, sha256_file, split_question_candidates
from .paired_pdf_import import render_source_preview


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


class QuestionCreate(BaseModel):
    id: str | None = None
    type: str
    subject: str = "考研数学一"
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


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, Any]:
    with connect() as connection:
        question_count = connection.execute("SELECT COUNT(*) AS count FROM questions").fetchone()["count"]
        template_count = connection.execute("SELECT COUNT(*) AS count FROM templates").fetchone()["count"]
    return {"ok": True, "service": "paper-helper", "question_count": question_count, "template_count": template_count}


@app.get("/api/tags")
def list_tags() -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM tags ORDER BY name").fetchall()
        return [dict(row) for row in rows]


@app.post("/api/tags")
def create_tag(payload: TagCreate) -> dict[str, Any]:
    tag_id = f"tag-{uuid.uuid4().hex[:10]}"
    try:
        with connect() as connection:
            connection.execute(
                "INSERT INTO tags(id, name, color, created_at) VALUES(?, ?, ?, ?)",
                (tag_id, payload.name.strip(), payload.color, utc_now()),
            )
            row = connection.execute("SELECT * FROM tags WHERE id = ?", (tag_id,)).fetchone()
            return dict(row)
    except Exception as error:
        raise HTTPException(status_code=409, detail=f"tag 已存在或无法创建：{error}") from error


@app.get("/api/questions")
def list_questions(
    subject: str | None = None,
    question_type: str | None = None,
    status: str = "approved",
) -> list[dict[str, Any]]:
    clauses = ["review_status = ?"]
    values: list[Any] = [status]
    if subject:
        clauses.append("subject = ?")
        values.append(subject)
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
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO questions(
                id, type, subject, stem_markdown, options_json, answer_markdown,
                analysis_markdown, scoring_points_json, tags_json, chapter,
                knowledge_points_json, difficulty, score, source_regions_json,
                analysis_source_document_id, analysis_regions_json,
                review_status, created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
            """,
            (
                question_id,
                data["type"],
                data["subject"],
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
    now = utc_now()
    with connect() as connection:
        existing = connection.execute("SELECT id FROM questions WHERE id = ?", (question_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="题目不存在。")
        connection.execute(
            """
            UPDATE questions SET type=?, subject=?, stem_markdown=?, options_json=?,
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
        rows = connection.execute("SELECT * FROM questions ORDER BY id").fetchall()
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
async def import_document(file: UploadFile = File(...)) -> dict[str, Any]:
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
        connection.execute(
            """
            INSERT INTO source_documents(
                id, filename, file_type, file_path, sha256, page_count, status, created_at
            ) VALUES(?, ?, ?, ?, ?, ?, 'processed', ?)
            """,
            (document_id, original_name, suffix.lstrip("."), str(target), sha256_file(target), len(pages), now),
        )
        review_ids = []
        for candidate in candidates:
            review_id = f"review-{uuid.uuid4().hex[:10]}"
            review_ids.append(review_id)
            connection.execute(
                """
                INSERT INTO review_items(
                    id, source_document_id, raw_text, parsed_question_json,
                    confidence, status, review_notes, created_at
                ) VALUES(?, ?, ?, ?, ?, 'pending', '', ?)
                """,
                (
                    review_id,
                    document_id,
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
    page: int = 1,
    page_size: int = 12,
) -> dict[str, Any]:
    page = max(1, page)
    page_size = min(50, max(1, page_size))
    with connect() as connection:
        total = connection.execute(
            "SELECT COUNT(*) AS count FROM review_items WHERE status = ?",
            (status,),
        ).fetchone()["count"]
        matched_count = connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM review_items
            WHERE status = ?
              AND json_extract(parsed_question_json, '$.analysis_matched') = 1
            """,
            (status,),
        ).fetchone()["count"]
        rows = connection.execute(
            """
            SELECT * FROM review_items
            WHERE status = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (status, page_size, (page - 1) * page_size),
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
    connection.execute(
        """
        INSERT INTO questions(
            id, type, subject, stem_markdown, options_json, answer_markdown,
            analysis_markdown, scoring_points_json, tags_json, chapter,
            knowledge_points_json, difficulty, score, source_document_id,
            source_page, source_regions_json, analysis_source_document_id,
            analysis_regions_json, review_status, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
        """,
        (
            question_id,
            data["type"],
            data["subject"],
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
def approve_matched_reviews() -> dict[str, Any]:
    approved: list[dict[str, Any]] = []
    skipped = 0
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM review_items WHERE status = 'pending' ORDER BY created_at, id"
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
def delete_unmatched_reviews() -> dict[str, Any]:
    with connect() as connection:
        cursor = connection.execute(
            """
            DELETE FROM review_items
            WHERE status = 'pending'
              AND coalesce(json_extract(parsed_question_json, '$.analysis_matched'), 0) = 0
            """
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
    with connect() as connection:
        existing = connection.execute("SELECT id FROM review_items WHERE id = ?", (review_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="审核项不存在。")
        connection.execute(
            "UPDATE review_items SET parsed_question_json=?, raw_text=?, review_notes=? WHERE id=?",
            (
                json.dumps(payload.parsed_question.model_dump(), ensure_ascii=False),
                payload.parsed_question.stem_markdown,
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
        connection.execute(
            """
            INSERT INTO templates(
                id, name, subject, duration_minutes, total_score, sections_json,
                distribution_rules_json, version, created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                template_id,
                payload.name,
                payload.subject,
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
        connection.execute(
            """
            UPDATE templates SET name=?, subject=?, duration_minutes=?, total_score=?,
                sections_json=?, distribution_rules_json=?, version=?, updated_at=?
            WHERE id=?
            """,
            (
                payload.name,
                payload.subject,
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
