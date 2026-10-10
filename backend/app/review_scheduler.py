"""Local FSRS scheduling. UTC storage; explicit ratings; transactional, replayable history."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import uuid
from collections import defaultdict
from contextlib import closing
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import Response
from fsrs import Card, Rating, ReviewLog, Scheduler
from pydantic import BaseModel, Field, field_validator

from .db import connect, row_to_question
from .study_explanations import enrich

router = APIRouter(prefix="/api/reviews", tags=["reviews"])
VERSION = "py-fsrs-6.3.2"
OPTIMIZER_MIN = 512  # The pinned optimizer otherwise returns defaults without training.
optimization_lock = threading.Lock()


def now_utc():
    return datetime.now(timezone.utc)


def dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def backup_before_migration(path):
    if not path.exists():
        return
    with closing(sqlite3.connect(path)) as source:
        if source.execute("SELECT 1 FROM sqlite_master WHERE name='scheduled_review_items'").fetchone():
            return
        directory = path.parent / "backups"
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / f"{path.stem}-before-reviews-v1-{uuid.uuid4().hex[:8]}.sqlite3"
        with closing(sqlite3.connect(target)) as destination:
            source.backup(destination)


class Settings(BaseModel):
    desired_retention: float = Field(.9, ge=.7, le=.99, allow_inf_nan=False)
    learning_steps: list[int] = Field(default_factory=lambda: [60, 600], max_length=8)
    relearning_steps: list[int] = Field(default_factory=lambda: [600], max_length=8)
    maximum_interval: int = Field(36500, ge=1, le=36500)
    new_limit: int = Field(20, ge=0, le=1000)
    review_limit: int = Field(200, ge=0, le=5000)
    timezone: str = "Asia/Shanghai"
    reminders_enabled: bool = True
    auto_add_wrong: bool = True

    @field_validator("learning_steps", "relearning_steps")
    @classmethod
    def valid_steps(cls, value):
        if any(not 1 <= step <= 86400 for step in value) or value != sorted(set(value)):
            raise ValueError("步长须递增，范围为 1 秒至 1 天。")
        return value

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("未知时区") from None
        return value


def init_reviews(c):
    c.executescript("""
    CREATE TABLE IF NOT EXISTS scheduled_review_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL, reason TEXT NOT NULL, card_json TEXT NOT NULL,
      due_at TEXT NOT NULL, suspended INTEGER NOT NULL DEFAULT 0, postponed_until TEXT,
      revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      UNIQUE(source_type, source_id));
    CREATE INDEX IF NOT EXISTS scheduled_review_due ON scheduled_review_items(suspended,due_at);
    CREATE TABLE IF NOT EXISTS review_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, item_id INTEGER,
      kind TEXT NOT NULL, rating INTEGER, hinted INTEGER NOT NULL DEFAULT 0,
      answer TEXT NOT NULL DEFAULT '', request_json TEXT NOT NULL DEFAULT '{}',
      before_json TEXT, after_json TEXT, log_json TEXT, settings_json TEXT,
      scheduler_version TEXT NOT NULL, created_at TEXT NOT NULL, undone_at TEXT);
    CREATE INDEX IF NOT EXISTS review_events_item ON review_events(item_id,seq);
    CREATE INDEX IF NOT EXISTS review_events_date ON review_events(created_at,kind,undone_at);
    CREATE TABLE IF NOT EXISTS review_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), config_json TEXT NOT NULL,
      parameters_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS review_presentations (
      token TEXT PRIMARY KEY, item_id INTEGER NOT NULL, revision INTEGER NOT NULL,
      settings_revision INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS review_optimizations (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL,
      settings_revision INTEGER NOT NULL, history_hash TEXT NOT NULL,
      sample_count INTEGER NOT NULL, parameters_json TEXT, error TEXT);
    """)
    c.execute("INSERT OR IGNORE INTO review_settings VALUES(1,?,?,0)",
              (dump(Settings().model_dump()), dump(list(Scheduler().parameters))))
    c.execute("UPDATE review_optimizations SET status='interrupted',error='应用重启，优化未完成，请重新运行。' WHERE status='running'")


def config(c):
    row = c.execute("SELECT * FROM review_settings WHERE id=1").fetchone()
    return {**json.loads(row["config_json"]), "parameters": json.loads(row["parameters_json"]), "revision": row["revision"]}


def scheduler(settings):
    return Scheduler(parameters=settings["parameters"], desired_retention=settings["desired_retention"],
                     learning_steps=tuple(timedelta(seconds=s) for s in settings["learning_steps"]),
                     relearning_steps=tuple(timedelta(seconds=s) for s in settings["relearning_steps"]),
                     maximum_interval=settings["maximum_interval"], enable_fuzzing=False)


def day_bounds(settings, now):
    zone = ZoneInfo(settings["timezone"])
    date = now.astimezone(zone).date()
    return (datetime.combine(date, time.min, zone).astimezone(timezone.utc),
            datetime.combine(date + timedelta(days=1), time.min, zone).astimezone(timezone.utc), str(date))


def require_item(c, item_id):
    row = c.execute("SELECT * FROM scheduled_review_items WHERE id=?", (item_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "复习项目不存在。")
    return row


def mutable(row):
    return {key: row[key] for key in ("card_json", "due_at", "suspended", "postponed_until")}


def effective_due(row):
    return max(row["due_at"], row["postponed_until"] or row["due_at"])


def public_item(row, now):
    q = json.loads(row["snapshot_json"])
    card = Card.from_json(row["card_json"])
    return {"id": row["id"], "source_type": row["source_type"], "source_id": row["source_id"],
            "title": q.get("stem_markdown", "")[:180], "subject": q.get("subject", ""),
            "reason": row["reason"], "state": int(card.state), "new": card.last_review is None,
            "due_at": effective_due(row), "overdue": effective_due(row) < now.isoformat(),
            "suspended": bool(row["suspended"]), "postponed_until": row["postponed_until"], "revision": row["revision"]}


def queue_data(c, settings, now):
    start, end, date = day_bounds(settings, now)
    events = c.execute("SELECT item_id,before_json FROM review_events WHERE kind='rating' AND undone_at IS NULL AND created_at>=? AND created_at<? ORDER BY seq", (start.isoformat(), end.isoformat())).fetchall()
    new_ids, review_ids = set(), set()
    for event in events:
        if event["item_id"] in new_ids | review_ids:
            continue
        before = Card.from_json(json.loads(event["before_json"])["card_json"])
        (new_ids if before.last_review is None else review_ids).add(event["item_id"])
    remaining_new = max(0, settings["new_limit"] - len(new_ids))
    remaining_review = max(0, settings["review_limit"] - len(review_ids))
    rows = c.execute("SELECT * FROM scheduled_review_items WHERE suspended=0 AND due_at<? ORDER BY due_at,id", (end.isoformat(),)).fetchall()
    rows = sorted((row for row in rows if effective_due(row) < end.isoformat()), key=lambda row: (effective_due(row), row["id"]))
    eligible, deferred = [], 0
    for row in rows:
        if row["id"] in new_ids | review_ids:
            eligible.append(row)
        elif Card.from_json(row["card_json"]).last_review is None:
            if remaining_new:
                eligible.append(row); remaining_new -= 1
            else:
                deferred += 1
        elif remaining_review:
            eligible.append(row); remaining_review -= 1
        else:
            deferred += 1
    ready = [row for row in eligible if effective_due(row) <= now.isoformat()]
    future = [row for row in eligible if effective_due(row) > now.isoformat()]
    summary = {"date": date, "timezone": settings["timezone"], "task_id": f"reviews:{settings['timezone']}:{date}",
               "remaining": len(eligible), "ready": len(ready), "upcoming": len(future), "deferred": deferred,
               "reviewed": len(new_ids | review_ids), "ratings": len(events), "new_used": len(new_ids), "review_used": len(review_ids),
               "completed": not eligible, "next_due": effective_due(future[0]) if future else None,
               "reminders_enabled": settings["reminders_enabled"], "total": c.execute("SELECT COUNT(*) FROM scheduled_review_items").fetchone()[0]}
    return eligible, ready, summary


def enroll(c, source_type, source_id, snapshot, reason):
    existing = c.execute("SELECT * FROM scheduled_review_items WHERE source_type=? AND source_id=?", (source_type, source_id)).fetchone()
    if existing:
        return existing
    now = now_utc()
    cursor = c.execute("INSERT INTO scheduled_review_items(source_type,source_id,snapshot_json,reason,card_json,due_at,created_at) VALUES(?,?,?,?,?,?,?)",
                       (source_type, source_id, dump(snapshot), reason, "{}", now.isoformat(), now.isoformat()))
    card = Card(card_id=cursor.lastrowid, due=now)
    c.execute("UPDATE scheduled_review_items SET card_json=? WHERE id=?", (card.to_json(), card.card_id))
    return require_item(c, card.card_id)


def enroll_wrong(c, question, reason):
    if config(c)["auto_add_wrong"]:
        enroll(c, "question", question["id"], question, reason)


class Enroll(BaseModel):
    source_type: Literal["question", "knowledge"] = "question"
    source_id: str = Field(min_length=1, max_length=300)


@router.post("/items")
def add_item(payload: Enroll):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        if payload.source_type == "question":
            row = c.execute("SELECT * FROM questions WHERE id=? AND review_status='approved'", (payload.source_id,)).fetchone()
            if not row:
                raise HTTPException(404, "已审核题目不存在。")
            snapshot = row_to_question(row)
        else:
            from .learning import knowledge_cards
            card = next((item for item in knowledge_cards(c) if item["id"] == payload.source_id), None)
            if not card or not card["examples"]:
                raise HTTPException(404, "该知识点没有可供复习的参考摘录。")
            snapshot = {"id": payload.source_id, "type": "short_answer", "subject": card["subject"], "tags": [], "options": [],
                        "stem_markdown": f"回忆并说明：{card['title']}", "answer_markdown": "\n\n".join(e["text"] for e in card["examples"]),
                        "analysis_markdown": "参考来自加入时的题库解析摘录，可在知识点阅读中查看关联题。", "knowledge_points": [card["title"]]}
        row = enroll(c, payload.source_type, payload.source_id, snapshot, "手动加入知识点" if payload.source_type == "knowledge" else "手动加入题目")
        return public_item(row, now_utc())


@router.post("/import-wrong")
def import_wrong():
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        before = c.execute("SELECT COUNT(*) FROM scheduled_review_items").fetchone()[0]
        for row in c.execute("SELECT q.* FROM wrong_questions w JOIN questions q ON q.id=w.question_id").fetchall():
            q = row_to_question(row); enroll(c, "question", q["id"], q, "从选择题错题本加入")
        for row in c.execute("SELECT w.question_id,a.snapshot_json FROM subjective_wrong w JOIN subjective_answers a ON a.session_id=w.last_session_id AND a.question_id=w.question_id").fetchall():
            enroll(c, "question", row["question_id"], json.loads(row["snapshot_json"]), "从主观题错题本加入")
        return {"added": c.execute("SELECT COUNT(*) FROM scheduled_review_items").fetchone()[0] - before}


@router.get("/summary")
def summary():
    with connect() as c:
        return queue_data(c, config(c), now_utc())[2]


@router.get("/queue")
def queue():
    with connect() as c:
        now = now_utc(); settings = config(c)
        eligible, ready, result = queue_data(c, settings, now)
        last = c.execute("SELECT id,item_id FROM review_events WHERE kind='rating' AND undone_at IS NULL ORDER BY seq DESC LIMIT 1").fetchone()
        return {"summary": result, "items": [public_item(row, now) for row in eligible],
                "ready_ids": [row["id"] for row in ready], "last_rating": dict(last) if last else None}


@router.get("/items")
def list_items(page: int = Query(1, ge=1), status: Literal["all", "suspended"] = "all"):
    with connect() as c:
        where = " WHERE suspended=1" if status == "suspended" else ""
        rows = c.execute(f"SELECT * FROM scheduled_review_items{where} ORDER BY due_at,id LIMIT 50 OFFSET ?", ((page-1)*50,)).fetchall()
        return {"items": [public_item(row, now_utc()) for row in rows], "total": c.execute(f"SELECT COUNT(*) FROM scheduled_review_items{where}").fetchone()[0]}


@router.get("/items/{item_id}")
def front(item_id: int):
    with connect() as c:
        row = require_item(c, item_id)
        q = json.loads(row["snapshot_json"])
        # Allowlist: explanations, visual specifications and scoring points never leave this endpoint.
        safe = {key: q.get(key) for key in ("id", "type", "subject", "stem_markdown", "options", "tags", "source_document_id", "source_regions", "source_page")}
        previously_revealed = bool(c.execute("SELECT 1 FROM review_presentations WHERE item_id=? AND revision=? LIMIT 1", (item_id, row["revision"])).fetchone())
        return {"item": public_item(row, now_utc()), "question": safe, "previously_revealed": previously_revealed}


@router.get("/items/{item_id}/preview")
def preview(item_id: int, kind: Literal["question", "analysis"] = "question", token: str = ""):
    from .document_preview import render_document_preview
    from .question_bundle import bundled_preview
    with connect() as c:
        row = require_item(c, item_id)
        if kind == "analysis" and not c.execute("SELECT 1 FROM review_presentations WHERE token=? AND item_id=? AND revision=?", (token, item_id, row["revision"])).fetchone():
            raise HTTPException(403, "请先查看参考解。")
        q = json.loads(row["snapshot_json"])
        source_id = q.get("analysis_source_document_id" if kind == "analysis" else "source_document_id")
        regions = q.get("analysis_regions" if kind == "analysis" else "source_regions") or []
        if kind == "question" and not regions and q.get("source_page"):
            regions = [{"page": q["source_page"], "bbox": [0, 0, 10000, 10000]}]
        source = c.execute("SELECT file_path FROM source_documents WHERE id=?", (source_id,)).fetchone()
    path = Path(source[0]) if source and source[0] else None
    if path and path.is_file():
        try:
            content = render_document_preview(path, regions)
        except Exception:
            raise HTTPException(422, "题目原始文件无法预览，请检查文件是否仍可用。") from None
    else:
        content = bundled_preview(q, kind)
        if not content:
            raise HTTPException(404, "此题原始文件不可用。文字快照仍保留。")
    return Response(content, media_type="image/png", headers={"Cache-Control": "no-store"})


class Revision(BaseModel):
    revision: int = Field(ge=0)


@router.post("/items/{item_id}/reveal")
def reveal(item_id: int, payload: Revision):
    with connect() as c:
        row = require_item(c, item_id); settings = config(c); now = now_utc()
        if payload.revision != row["revision"]:
            raise HTTPException(409, "题目调度已变更，请刷新队列。")
        card = Card.from_json(row["card_json"]); engine = scheduler(settings)
        previews = []
        for rating in Rating:
            next_card, _ = engine.review_card(card, rating, review_datetime=now)
            previews.append({"rating": int(rating), "due_at": next_card.due.isoformat(), "seconds": (next_card.due-now).total_seconds()})
        token = uuid.uuid4().hex
        c.execute("DELETE FROM review_presentations WHERE created_at<?", ((now-timedelta(days=2)).isoformat(),))
        c.execute("INSERT INTO review_presentations VALUES(?,?,?,?,?)", (token, item_id, row["revision"], settings["revision"], now.isoformat()))
        return {"question": enrich(json.loads(row["snapshot_json"])), "previews": previews, "token": token}


class Rate(Revision):
    request_id: str = Field(min_length=8, max_length=100)
    token: str = Field(min_length=1, max_length=100)
    rating: int = Field(ge=1, le=4)
    hinted: bool = False
    answer: str = Field("", max_length=30000)


def existing_request(c, request_id, item_id, kind, payload):
    event = c.execute("SELECT * FROM review_events WHERE id=?", (request_id,)).fetchone()
    if event:
        if event["item_id"] != item_id or event["kind"] != kind or event["request_json"] != dump(payload):
            raise HTTPException(409, "此提交标识已用于其他操作。")
        if event["undone_at"]:
            raise HTTPException(409, "此评级已撤销，请重新打开题目。")
    return event


def record(c, row, kind, request_id, payload, before, after, *, rating=None, log=None, settings=None, hinted=False, answer=""):
    c.execute("INSERT INTO review_events(id,item_id,kind,rating,hinted,answer,request_json,before_json,after_json,log_json,settings_json,scheduler_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
              (request_id, row["id"], kind, rating, int(hinted), answer, dump(payload), dump(before), dump(after), log.to_json() if log else None, dump(settings) if settings else None, VERSION, now_utc().isoformat()))


def write_state(c, item_id, state):
    c.execute("UPDATE scheduled_review_items SET card_json=?,due_at=?,suspended=?,postponed_until=?,revision=revision+1 WHERE id=?",
              (state["card_json"], state["due_at"], state["suspended"], state["postponed_until"], item_id))


@router.post("/items/{item_id}/rate")
def rate(item_id: int, payload: Rate):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        prior = existing_request(c, payload.request_id, item_id, "rating", payload.model_dump())
        if prior:
            return {"event_id": prior["id"], "card": json.loads(json.loads(prior["after_json"])["card_json"])}
        row = require_item(c, item_id); settings = config(c); now = now_utc()
        token = c.execute("SELECT * FROM review_presentations WHERE token=? AND item_id=?", (payload.token, item_id)).fetchone()
        if payload.revision != row["revision"] or not token or token["revision"] != row["revision"] or token["settings_revision"] != settings["revision"]:
            raise HTTPException(409, "题目或配置已变更，请重新查看参考答案后评级。")
        ready = queue_data(c, settings, now)[1]
        if item_id not in {item["id"] for item in ready}:
            raise HTTPException(409, "此题尚未到期、已暂停，或超出今日限额。")
        card = Card.from_json(row["card_json"])
        if card.last_review and card.last_review > now:
            raise HTTPException(409, "系统时间早于上次复习，请先校准时钟。")
        next_card, log = scheduler(settings).review_card(card, Rating(payload.rating), review_datetime=now)
        before = mutable(row); after = {**before, "card_json": next_card.to_json(), "due_at": next_card.due.isoformat(), "postponed_until": None}
        write_state(c, item_id, after)
        record(c, row, "rating", payload.request_id, payload.model_dump(), before, after, rating=payload.rating, log=log, settings=settings, hinted=payload.hinted, answer=payload.answer)
        return {"event_id": payload.request_id, "card": next_card.to_dict()}


class Undo(BaseModel):
    event_id: str


@router.post("/undo")
def undo(payload: Undo):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        event = c.execute("SELECT * FROM review_events WHERE id=? AND kind='rating'", (payload.event_id,)).fetchone()
        if not event:
            raise HTTPException(404, "评级记录不存在。")
        if event["undone_at"]:
            return {"item_id": event["item_id"]}
        last = c.execute("SELECT id FROM review_events WHERE kind='rating' AND undone_at IS NULL ORDER BY seq DESC LIMIT 1").fetchone()
        row = require_item(c, event["item_id"])
        later = c.execute("SELECT 1 FROM review_events WHERE item_id=? AND seq>? AND kind!='undo' AND undone_at IS NULL", (row["id"], event["seq"])).fetchone()
        if last["id"] != event["id"] or later:
            raise HTTPException(409, "只能撤销最近一次评级；该题若已暂停、暂缓或重排，请先保留当前调度。")
        before = mutable(row); after = json.loads(event["before_json"])
        write_state(c, row["id"], after)
        c.execute("UPDATE review_events SET undone_at=? WHERE id=?", (now_utc().isoformat(), event["id"]))
        record(c, row, "undo", uuid.uuid4().hex, payload.model_dump(), before, after)
        return {"item_id": row["id"]}


class Manage(Revision):
    request_id: str = Field(min_length=8, max_length=100)
    action: Literal["suspend", "resume", "postpone"]
    days: int = Field(1, ge=1, le=365)


@router.post("/items/{item_id}/manage")
def manage(item_id: int, payload: Manage):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        if existing_request(c, payload.request_id, item_id, payload.action, payload.model_dump()):
            return {"ok": True}
        row = require_item(c, item_id)
        if row["revision"] != payload.revision:
            raise HTTPException(409, "调度已更新，请刷新。")
        before = mutable(row); after = dict(before)
        if payload.action == "postpone":
            settings = config(c); now = now_utc()
            zone = ZoneInfo(settings["timezone"])
            tomorrow = datetime.combine(now.astimezone(zone).date()+timedelta(days=payload.days), time.min, zone).astimezone(timezone.utc)
            after["postponed_until"] = tomorrow.isoformat()
        else:
            after["suspended"] = int(payload.action == "suspend")
        write_state(c, item_id, after)
        record(c, row, payload.action, payload.request_id, payload.model_dump(), before, after)
        return {"ok": True}


@router.get("/history")
def history(item_id: int | None = None, page: int = Query(1, ge=1)):
    with connect() as c:
        where, args = (" WHERE item_id=?", [item_id]) if item_id is not None else ("", [])
        rows = c.execute("SELECT * FROM review_events"+where+" ORDER BY seq DESC LIMIT 50 OFFSET ?", [*args, (page-1)*50]).fetchall()
        result = []
        for row in rows:
            event = dict(row)
            for key in ("before_json", "after_json", "settings_json", "log_json"):
                raw = event.pop(key)
                event[key.removesuffix("_json")] = json.loads(raw) if raw else None
            event.pop("request_json")
            result.append(event)
        return {"items": result, "total": c.execute("SELECT COUNT(*) FROM review_events"+where, args).fetchone()[0]}


def optimization_data(c):
    rows = c.execute("SELECT item_id,log_json,hinted FROM review_events WHERE kind='rating' AND undone_at IS NULL ORDER BY seq").fetchall()
    # Excluding whole hinted chains preserves complete card histories for the optimizer.
    excluded = {row["item_id"] for row in rows if row["hinted"]}
    logs = [ReviewLog.from_json(row["log_json"]) for row in rows if row["item_id"] not in excluded]
    grouped = defaultdict(list)
    for log in logs:
        grouped[log.card_id].append(log)
    samples = 0
    for chain in grouped.values():
        chain.sort(key=lambda log: log.review_datetime)
        samples += sum((b.review_datetime-a.review_datetime).days > 0 for a, b in zip(chain[:63], chain[1:64]))
    fingerprint = hashlib.sha256(dump([dict(row) for row in rows]).encode()).hexdigest()
    return logs, samples, fingerprint, len(excluded)


@router.get("/settings")
def get_settings():
    with connect() as c:
        _, samples, _, excluded = optimization_data(c)
        job = c.execute("SELECT * FROM review_optimizations ORDER BY created_at DESC,rowid DESC LIMIT 1").fetchone()
        return {**config(c), "scheduler_version": VERSION, "optimizer_samples": samples, "optimizer_minimum": OPTIMIZER_MIN,
                "optimizer_excluded_cards": excluded, "optimization": dict(job) if job else None}


class UpdateSettings(Settings):
    revision: int = Field(ge=0)


@router.put("/settings")
def update_settings(payload: UpdateSettings):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        if config(c)["revision"] != payload.revision:
            raise HTTPException(409, "配置已在其他窗口更新，请重新打开设置。")
        c.execute("UPDATE review_settings SET config_json=?,revision=revision+1 WHERE id=1", (dump(payload.model_dump(exclude={"revision"})),))
    return get_settings()


@router.post("/settings/reset")
def reset_settings(payload: Revision):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        current = config(c)
        if current["revision"] != payload.revision:
            raise HTTPException(409, "配置已更新，请刷新。")
        defaults = Settings(timezone=current["timezone"], reminders_enabled=current["reminders_enabled"], auto_add_wrong=current["auto_add_wrong"]).model_dump()
        c.execute("UPDATE review_settings SET config_json=?,parameters_json=?,revision=revision+1 WHERE id=1", (dump(defaults), dump(list(Scheduler().parameters))))
    return get_settings()


@router.post("/reschedule")
def reschedule(payload: Revision):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        settings = config(c)
        if settings["revision"] != payload.revision:
            raise HTTPException(409, "配置已更新，请刷新。")
        engine = scheduler(settings); count = 0
        for row in c.execute("SELECT * FROM scheduled_review_items").fetchall():
            logs = [ReviewLog.from_json(event[0]) for event in c.execute("SELECT log_json FROM review_events WHERE item_id=? AND kind='rating' AND undone_at IS NULL ORDER BY seq", (row["id"],)).fetchall()]
            if not logs:
                continue
            card = engine.reschedule_card(Card.from_json(row["card_json"]), logs)
            before = mutable(row); after = {**before, "card_json": card.to_json(), "due_at": card.due.isoformat()}
            write_state(c, row["id"], after)
            record(c, row, "reschedule", uuid.uuid4().hex, payload.model_dump(), before, after, settings=settings)
            count += 1
        return {"count": count}


def run_optimization(job_id, logs):
    try:
        from fsrs import Optimizer
        weights = [float(value) for value in Optimizer(logs).compute_optimal_parameters()]
        Scheduler(parameters=weights)  # Validate before offering a candidate.
        with connect() as c:
            c.execute("UPDATE review_optimizations SET status='ready',parameters_json=? WHERE id=?", (dump(weights), job_id))
    except Exception:
        with connect() as c:
            c.execute("UPDATE review_optimizations SET status='failed',error='优化未完成，请检查一键配置中的优化器依赖后重试。' WHERE id=?", (job_id,))
    finally:
        optimization_lock.release()


@router.post("/optimize")
def optimize(tasks: BackgroundTasks):
    if not optimization_lock.acquire(blocking=False):
        raise HTTPException(409, "已有参数优化正在运行。")
    try:
        with connect() as c:
            logs, samples, fingerprint, _ = optimization_data(c)
            if samples < OPTIMIZER_MIN:
                raise HTTPException(422, f"需要至少 {OPTIMIZER_MIN} 条有效跨日复习记录，当前 {samples} 条。继续使用默认参数。")
            job_id = uuid.uuid4().hex
            c.execute("INSERT INTO review_optimizations VALUES(?,?,?,?,?,?,NULL,NULL)", (job_id, "running", now_utc().isoformat(), config(c)["revision"], fingerprint, samples))
        tasks.add_task(run_optimization, job_id, logs)
        return {"id": job_id, "status": "running"}
    except Exception:
        optimization_lock.release()
        raise


class ApplyOptimization(BaseModel):
    job_id: str


@router.post("/optimize/apply")
def apply_optimization(payload: ApplyOptimization):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        job = c.execute("SELECT * FROM review_optimizations WHERE id=?", (payload.job_id,)).fetchone()
        if not job or job["status"] != "ready":
            raise HTTPException(409, "没有可应用的优化结果。")
        if config(c)["revision"] != job["settings_revision"] or optimization_data(c)[2] != job["history_hash"]:
            raise HTTPException(409, "优化期间历史或设置有变化，请重新优化，避免覆盖新记录。")
        c.execute("UPDATE review_settings SET parameters_json=?,revision=revision+1 WHERE id=1", (job["parameters_json"],))
        c.execute("UPDATE review_optimizations SET status='applied' WHERE id=?", (job["id"],))
    return get_settings()
