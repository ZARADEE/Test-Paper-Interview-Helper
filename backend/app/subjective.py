"""Subjective practice: immutable question snapshots, drafts, explicit AI and grade revisions."""
from __future__ import annotations
import hashlib
import json
import random
import sqlite3
import uuid
from contextlib import closing
from typing import Literal
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from .db import connect, row_to_question, utc_now
from .agent_composer import AgentSettings
from .grading import grade_answer, rubric_for
from .study_explanations import enrich

router = APIRouter(prefix="/api/subjective", tags=["subjective"])
dump = lambda value: json.dumps(value, ensure_ascii=False)

def backup_before_migration(path):
    if not path.exists():
        return
    with closing(sqlite3.connect(path)) as source:
        if source.execute("SELECT 1 FROM sqlite_master WHERE name='subjective_sessions'").fetchone():
            return
        directory=path.parent / "backups"
        directory.mkdir(parents=True, exist_ok=True)
        target=directory / (path.stem + "-before-subjective-v1-" + uuid.uuid4().hex[:8] + ".sqlite3")
        with closing(sqlite3.connect(target)) as dest:
            source.backup(dest)

def init_subjective(connection):
    connection.executescript("""
    CREATE TABLE IF NOT EXISTS subjective_sessions(
        id TEXT PRIMARY KEY, subject TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subjective_answers(
        session_id TEXT NOT NULL REFERENCES subjective_sessions(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL, position INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
        answer TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
        submitted_at TEXT, revealed INTEGER NOT NULL DEFAULT 0, independent INTEGER NOT NULL DEFAULT 1,
        verdict TEXT, score REAL, grading_method TEXT, feedback TEXT NOT NULL DEFAULT '',
        point_scores_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL,
        PRIMARY KEY(session_id,question_id));
    CREATE TABLE IF NOT EXISTS subjective_grade_events(
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, question_id TEXT NOT NULL, kind TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(session_id,question_id) REFERENCES subjective_answers(session_id,question_id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS subjective_wrong(
        question_id TEXT PRIMARY KEY, last_session_id TEXT NOT NULL, wrong_count INTEGER NOT NULL, updated_at TEXT NOT NULL);
    """)

class Start(BaseModel):
    subject: str = ""
    chapter: str = ""
    question_type: Literal["", "solution", "short_answer", "fill"] = ""
    count: int = Field(10, ge=1, le=100)
    mode: Literal["standard", "wrong_book"] = "standard"
    question_ids: list[str] = Field(default_factory=list, max_length=100)

class Answer(BaseModel):
    answer: str = Field("", max_length=30000)
    revision: int = Field(ge=0)
    independent: bool = True

class Grade(BaseModel):
    verdict: Literal["correct", "partial", "incorrect"]
    score: float | None = Field(None, ge=0, allow_inf_nan=False)
    feedback: str = Field("", max_length=6000)
    point_scores: list[float] = Field(default_factory=list, max_length=100)
    suggestion_id: str | None = None

class Judge(BaseModel):
    enabled: bool = False
    agent: AgentSettings

def require_answer(connection, session_id, question_id):
    row=connection.execute("SELECT * FROM subjective_answers WHERE session_id=? AND question_id=?",(session_id,question_id)).fetchone()
    if not row:
        raise HTTPException(404, "题目不属于本次主观题练习。")
    return row

def public_answer(connection, row):
    q=json.loads(row["snapshot_json"])
    if not row["submitted_at"]:
        for k in ("answer_markdown", "analysis_markdown"):
            q[k]=""
        for k in ("visual", "option_explanations", "scoring_points", "analysis_regions", "analysis_source_document_id"):
            q.pop(k,None)
    events=[{**dict(e), "payload": json.loads(e["payload_json"])} for e in connection.execute(
        "SELECT id,kind,payload_json,created_at FROM subjective_grade_events WHERE session_id=? AND question_id=? ORDER BY rowid",
        (row["session_id"],row["question_id"]))]
    for e in events:
        e.pop("payload_json")
    return {"question":q, **{k:row[k] for k in ("answer","revision","submitted_at","independent","verdict","score","grading_method","feedback","updated_at")},
        "point_scores":json.loads(row["point_scores_json"]), "rubric":rubric_for(q) if row["submitted_at"] else [], "events":events}

@router.get("/catalog")
def catalog():
    with connect() as c:
        rows=c.execute("SELECT subject,chapter,type,COUNT(*) count FROM questions WHERE review_status='approved' AND type IN ('solution','short_answer','fill') GROUP BY subject,chapter,type ORDER BY subject,chapter,type").fetchall()
        wrong=c.execute("SELECT COUNT(*) FROM subjective_wrong").fetchone()[0]
    return {"items":[dict(r) for r in rows], "wrong_count":wrong}

@router.post("/sessions")
def start(payload: Start):
    with connect() as c:
        rows=c.execute("SELECT * FROM questions WHERE review_status='approved' AND type IN ('solution','short_answer','fill') ORDER BY id").fetchall()
        wrong={r[0] for r in c.execute("SELECT question_id FROM subjective_wrong")}
        rows=[r for r in rows if (not payload.subject or r["subject"]==payload.subject) and
              (not payload.chapter or r["chapter"]==payload.chapter) and (not payload.question_type or r["type"]==payload.question_type) and
              (payload.mode!="wrong_book" or r["id"] in wrong) and (not payload.question_ids or r["id"] in payload.question_ids)]
        if not rows:
            raise HTTPException(404, "没有符合筛选条件的主观题。")
        rows=random.SystemRandom().sample(rows,min(payload.count,len(rows)))
        sid="subjective-"+uuid.uuid4().hex[:16]; now=utc_now()
        c.execute("INSERT INTO subjective_sessions VALUES(?,?,?,?)",(sid,payload.subject or "全部学科",payload.mode,now))
        for pos,row in enumerate(rows):
            q=enrich(row_to_question(row))
            q["snapshot_version"]=hashlib.sha256(dump(q).encode()).hexdigest()
            c.execute("INSERT INTO subjective_answers(session_id,question_id,position,snapshot_json,updated_at) VALUES(?,?,?,?,?)",(sid,q["id"],pos,dump(q),now))
    return session(sid)

@router.get("/sessions")
def history(limit: int = Query(30,ge=1,le=100)):
    with connect() as c:
        rows=c.execute("""SELECT s.*, COUNT(a.question_id) total, SUM(a.submitted_at IS NOT NULL) submitted,
            SUM(a.verdict IS NOT NULL) graded, SUM(a.verdict='correct') correct
            FROM subjective_sessions s JOIN subjective_answers a ON a.session_id=s.id
            GROUP BY s.id ORDER BY s.created_at DESC LIMIT ?""",(limit,)).fetchall()
    return [dict(r) for r in rows]

@router.get("/sessions/{session_id}")
def session(session_id: str):
    with connect() as c:
        head=c.execute("SELECT * FROM subjective_sessions WHERE id=?",(session_id,)).fetchone()
        if not head:
            raise HTTPException(404, "主观题练习不存在。")
        items=[public_answer(c,r) for r in c.execute("SELECT * FROM subjective_answers WHERE session_id=? ORDER BY position",(session_id,))]
    return {**dict(head), "items":items}

def save_answer(session_id,question_id,payload,submit):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        row=require_answer(c,session_id,question_id)
        if row["submitted_at"]:
            raise HTTPException(409, "已提交作答不可覆盖，请创建重练记录。")
        if payload.revision!=row["revision"]:
            raise HTTPException(409, "作答版本已变化，请重新载入本组练习，避免覆盖新草稿。")
        now=utc_now()
        c.execute("UPDATE subjective_answers SET answer=?,revision=revision+1,submitted_at=?,revealed=?,independent=MIN(independent,?),updated_at=? WHERE session_id=? AND question_id=?",
            (payload.answer,now if submit else None,int(submit),int(payload.independent),now,session_id,question_id))
        return public_answer(c,require_answer(c,session_id,question_id))

@router.put("/sessions/{session_id}/answers/{question_id}")
def draft(session_id: str,question_id: str,payload: Answer):
    return save_answer(session_id,question_id,payload,False)

@router.post("/sessions/{session_id}/answers/{question_id}/submit")
def submit(session_id: str,question_id: str,payload: Answer):
    return save_answer(session_id,question_id,payload,True)

@router.post("/sessions/{session_id}/answers/{question_id}/judge")
def judge(session_id: str,question_id: str,payload: Judge):
    if not payload.enabled:
        raise HTTPException(400, "请先手动勾选使用 Agent 判题。")
    with connect() as c:
        row=require_answer(c,session_id,question_id)
        if not row["submitted_at"]:
            raise HTTPException(409, "请先提交作答再请求判题。")
        q=json.loads(row["snapshot_json"]); answer=row["answer"]
    try:
        result=grade_answer(payload.agent,q,answer)
    except ValueError as exc:
        raise HTTPException(422,str(exc)) from None
    # No credentials are written; model output remains a suggestion until confirmed.
    with connect() as c:
        c.execute("INSERT INTO subjective_grade_events VALUES(?,?,?,?,?,?)",(uuid.uuid4().hex,session_id,question_id,"agent_suggestion",dump(result),utc_now()))
        return public_answer(c,require_answer(c,session_id,question_id))

@router.post("/sessions/{session_id}/answers/{question_id}/grade")
def confirm_grade(session_id: str,question_id: str,payload: Grade):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        row=require_answer(c,session_id,question_id)
        if not row["submitted_at"]:
            raise HTTPException(409, "请先提交作答。")
        q=json.loads(row["snapshot_json"]); rubric=rubric_for(q)
        score=payload.score; verdict=payload.verdict; feedback=payload.feedback; method="self_assessed"
        points=payload.point_scores
        if payload.suggestion_id:
            event=c.execute("SELECT payload_json FROM subjective_grade_events WHERE id=? AND session_id=? AND question_id=? AND kind='agent_suggestion'",(payload.suggestion_id,session_id,question_id)).fetchone()
            if not event:
                raise HTTPException(404, "判题建议不存在。")
            suggestion=json.loads(event[0])
            if suggestion["verdict"]=="needs_review":
                raise HTTPException(422, "该建议需人工复核，不能直接采用。")
            score=suggestion["score"]; verdict=suggestion["verdict"]; feedback=suggestion["feedback"]; method="agent_confirmed"
            points=[p["awarded"] for p in sorted(suggestion["points"],key=lambda p:int(p["id"]))]
        if score is not None and score>q["score"]:
            raise HTTPException(422, "得分不能超过题目总分。")
        if score is not None and verdict=="correct" and score<q["score"]:
            raise HTTPException(422, "得分未满分时请选择部分正确，或修改得分。")
        if points:
            if len(points)!=len(rubric) or any(not isinstance(v,(int,float)) or not 0<=v<=p["max_score"] for v,p in zip(points,rubric)):
                raise HTTPException(422, "评分点得分超限或不完整。")
            if score is None or abs(sum(points)-score)>1e-6:
                raise HTTPException(422, "评分点合计与总分不一致。")
        if not row["answer"].strip() and (verdict!="incorrect" or score not in (0,None)):
            raise HTTPException(422, "空白作答不能评为正确或给分。")
        now=utc_now()
        c.execute("UPDATE subjective_answers SET verdict=?,score=?,grading_method=?,feedback=?,point_scores_json=?,updated_at=? WHERE session_id=? AND question_id=?",(verdict,score,method,feedback,dump(points),now,session_id,question_id))
        c.execute("INSERT INTO subjective_grade_events VALUES(?,?,?,?,?,?)",(uuid.uuid4().hex,session_id,question_id,"grade_confirmed",dump({"verdict":verdict,"score":score,"feedback":feedback,"method":method,"point_scores":points,"suggestion_id":payload.suggestion_id}),now))
        # Recompute from each attempt's final verdict, so regrading never double-counts.
        failures=c.execute("SELECT COUNT(*) FROM subjective_answers WHERE question_id=? AND verdict IN ('partial','incorrect')",(question_id,)).fetchone()[0]
        if verdict!="correct":
            from .review_scheduler import enroll_wrong
            enroll_wrong(c, q, f"主观题确认未掌握 · 练习 {session_id}")
            c.execute("INSERT INTO subjective_wrong VALUES(?,?,?,?) ON CONFLICT(question_id) DO UPDATE SET last_session_id=excluded.last_session_id,wrong_count=excluded.wrong_count,updated_at=excluded.updated_at",(question_id,session_id,failures,now))
        elif failures==0:
            c.execute("DELETE FROM subjective_wrong WHERE question_id=?",(question_id,))
        else:
            c.execute("UPDATE subjective_wrong SET wrong_count=? WHERE question_id=?",(failures,question_id))
        return public_answer(c,require_answer(c,session_id,question_id))

@router.get("/wrong-book")
def wrong_book():
    with connect() as c:
        rows=c.execute("SELECT w.*,a.snapshot_json,a.answer,a.verdict,a.score FROM subjective_wrong w JOIN subjective_answers a ON a.session_id=w.last_session_id AND a.question_id=w.question_id ORDER BY w.updated_at DESC").fetchall()
    return [{**{k:r[k] for k in ("question_id","last_session_id","wrong_count","answer","verdict","score")},"question":json.loads(r["snapshot_json"])} for r in rows]

@router.delete("/wrong-book/{question_id}")
def remove_wrong(question_id: str):
    with connect() as c:
        c.execute("DELETE FROM subjective_wrong WHERE question_id=?",(question_id,))
    return {"ok":True}
