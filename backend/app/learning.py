"""Local knowledge index, reflection notes and practice history."""
from __future__ import annotations

import hashlib
import json
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .db import connect, row_to_question, utc_now

router = APIRouter(prefix="/api/learning", tags=["learning"])


def init_learning(connection):
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS learning_notes (
            question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
            favorite INTEGER NOT NULL DEFAULT 0,
            cause TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS knowledge_discussions (
            id TEXT PRIMARY KEY, card_id TEXT NOT NULL, parent_id TEXT,
            nickname TEXT NOT NULL, body TEXT NOT NULL, liked INTEGER NOT NULL DEFAULT 0,
            reported INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
        );
    """)


class Reflection(BaseModel):
    favorite: bool = False
    cause: str = Field(default="", max_length=80)
    note: str = Field(default="", max_length=2000)


@router.get("/notes/{question_id}")
def get_note(question_id: str):
    with connect() as connection:
        row = connection.execute("SELECT * FROM learning_notes WHERE question_id=?", (question_id,)).fetchone()
    return dict(row) if row else {"favorite": False, "cause": "", "note": ""}


@router.put("/notes/{question_id}")
def save_note(question_id: str, payload: Reflection):
    with connect() as connection:
        if not connection.execute("SELECT id FROM questions WHERE id=?", (question_id,)).fetchone():
            raise HTTPException(404, "题目不存在。")
        connection.execute(
            "INSERT INTO learning_notes VALUES(?, ?, ?, ?) ON CONFLICT(question_id) DO UPDATE SET favorite=excluded.favorite,cause=excluded.cause,note=excluded.note",
            (question_id, payload.favorite, payload.cause, payload.note),
        )
    return payload.model_dump()


def knowledge_cards(connection):
    rows = connection.execute("SELECT * FROM questions WHERE review_status='approved' ORDER BY id").fetchall()
    attempts = {row["question_id"]: dict(row) for row in connection.execute(
        "SELECT question_id,COUNT(*) attempts,SUM(is_correct) correct FROM practice_attempts GROUP BY question_id"
    )}
    cards = {}
    for row in rows:
        q = row_to_question(row)
        tags = q.get("tags", [])
        major = tags[0] if tags else q["chapter"] or "未分类"
        points = q.get("knowledge_points") or tags[1:2] or [q["chapter"] or major]
        for point in dict.fromkeys(points):
            key = hashlib.sha256(json.dumps([q["question_bank_id"], major, point], ensure_ascii=False).encode()).hexdigest()[:20]
            card = cards.setdefault(key, {"id": key, "title": point, "subject": q["subject"],
                "question_bank_id": q["question_bank_id"], "major": major, "question_ids": [],
                "attempts": 0, "correct": 0, "examples": []})
            card["question_ids"].append(q["id"])
            stat = attempts.get(q["id"], {})
            card["attempts"] += stat.get("attempts", 0)
            card["correct"] += stat.get("correct", 0)
            if q["analysis_markdown"] and len(card["examples"]) < 2:
                card["examples"].append({"question_id": q["id"], "text": q["analysis_markdown"][:1800]})
    return list(cards.values())


@router.get("/overview")
def overview():
    with connect() as connection:
        cards = knowledge_cards(connection)
        sessions = [dict(row) for row in connection.execute(
            "SELECT s.*, (SELECT COUNT(*) FROM practice_attempts a WHERE a.session_id=s.id AND a.is_correct=1) correct_count FROM practice_sessions s ORDER BY s.created_at DESC LIMIT 50"
        )]
        favorites = [row[0] for row in connection.execute("SELECT question_id FROM learning_notes WHERE favorite=1")]
        stats = dict(connection.execute("SELECT COUNT(*) attempts,COALESCE(SUM(is_correct),0) correct FROM practice_attempts").fetchone())
    return {"cards": cards, "sessions": sessions, "favorites": favorites, "stats": stats}


class Discussion(BaseModel):
    nickname: str = Field(min_length=1, max_length=40)
    body: str = Field(min_length=1, max_length=2000)
    parent_id: str | None = None


@router.get("/cards/{card_id}/discussions")
def discussions(card_id: str):
    with connect() as connection:
        return [dict(row) for row in connection.execute("SELECT * FROM knowledge_discussions WHERE card_id=? AND reported=0 ORDER BY created_at", (card_id,))]


@router.post("/cards/{card_id}/discussions")
def discuss(card_id: str, payload: Discussion):
    with connect() as connection:
        if not any(card["id"] == card_id for card in knowledge_cards(connection)):
            raise HTTPException(404, "知识卡不存在。")
        if not payload.body.strip() or not payload.nickname.strip():
            raise HTTPException(422, "昵称和内容不能为空。")
        if payload.parent_id and not connection.execute("SELECT id FROM knowledge_discussions WHERE id=? AND card_id=?", (payload.parent_id, card_id)).fetchone():
            raise HTTPException(422, "回复目标不属于此知识卡。")
        connection.execute("INSERT INTO knowledge_discussions(id,card_id,parent_id,nickname,body,created_at) VALUES(?,?,?,?,?,?)",
                           (uuid.uuid4().hex, card_id, payload.parent_id, payload.nickname.strip(), payload.body.strip(), utc_now()))
    return discussions(card_id)


@router.post("/discussions/{discussion_id}/{action}")
def react(discussion_id: str, action: str):
    if action not in ("like", "report"):
        raise HTTPException(422, "不支持的操作。")
    with connect() as connection:
        column = "liked=1-liked" if action == "like" else "reported=1"
        connection.execute(f"UPDATE knowledge_discussions SET {column} WHERE id=?", (discussion_id,))
    return {"ok": True}
