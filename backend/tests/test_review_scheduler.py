from __future__ import annotations

import json
import math
import sqlite3
import sys
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import BackgroundTasks, HTTPException
from fastapi.testclient import TestClient
from fsrs import Card, Rating, Scheduler, State
from app import db, review_scheduler as r, subjective
from app.main import app, answer_practice_question, start_practice as start_practice_session, PracticeAnswerRequest, PracticeStartRequest


class ReviewSchedulerTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        for key, value in {"DATA_ROOT": self.root, "DB_PATH": self.root/"test.sqlite", "DOCUMENT_ROOT": self.root/"documents", "QUESTION_ROOT": self.root/"questions", "EXPORT_ROOT": self.root/"exports"}.items():
            manager = patch.object(db, key, value); manager.start(); self.addCleanup(manager.stop)
        with patch.object(db, "load_bundled_questions", return_value=True), patch("app.zhijing_bundle.load", return_value=0), patch("app.github_bundle.load", return_value=0):
            db.init_db()
        self.now = datetime(2026, 10, 10, 6, tzinfo=timezone.utc)
        clock = patch.object(r, "now_utc", side_effect=lambda:self.now); clock.start(); self.addCleanup(clock.stop)
        self.client = TestClient(app)
        self.question = self.insert_question("fixture")

    def insert_question(self, qid, kind="choice"):
        with db.connect() as c:
            c.execute("INSERT INTO questions(id,type,subject,stem_markdown,answer_markdown,analysis_markdown,options_json,knowledge_points_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                      (qid, kind, "计算机408", "描述二分查找的复杂度", "A", "有序数组每轮减半，复杂度为 O(log n)。", '[{"key":"A","text":"O(log n)"},{"key":"B","text":"O(n)"}]', '["二分查找"]', db.utc_now(), db.utc_now()))
            return db.row_to_question(c.execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone())

    def add(self, qid="fixture"):
        return r.add_item(r.Enroll(source_id=qid))

    def row(self, item_id):
        with db.connect() as c:
            return dict(r.require_item(c, item_id))

    def rate(self, item_id, rating=3, hinted=False):
        row = self.row(item_id)
        reveal = r.reveal(item_id, r.Revision(revision=row["revision"]))
        payload = r.Rate(revision=row["revision"], token=reveal["token"], rating=rating, hinted=hinted, request_id=uuid.uuid4().hex, answer="回忆内容")
        return r.rate(item_id, payload), payload

    def settings(self, **changes):
        current = r.get_settings()
        return r.update_settings(r.UpdateSettings(**{**current, **changes}))

    def test_four_ratings_match_pinned_library_and_previews(self):
        for rating in range(1, 5):
            with self.subTest(rating=rating):
                qid=f"rating-{rating}"; self.insert_question(qid); item=self.add(qid)
                card=Card.from_json(self.row(item["id"])["card_json"])
                expected, log=Scheduler(enable_fuzzing=False).review_card(card, Rating(rating), review_datetime=self.now)
                preview=r.reveal(item["id"],r.Revision(revision=0))
                self.assertEqual(preview["previews"][rating-1]["due_at"],expected.due.isoformat())
                result,payload=self.rate(item["id"],rating)
                self.assertEqual(result["card"],expected.to_dict())
                self.assertEqual(r.history(page=1)["items"][0]["log"],log.to_dict())
                self.assertEqual(r.rate(item["id"],payload),result)

    def test_learning_review_lapse_relearning_and_long_overdue(self):
        item=self.add(); card_id=item["id"]
        result,_=self.rate(card_id,3);self.assertEqual(result["card"]["state"],int(State.Learning))
        self.now=datetime.fromisoformat(result["card"]["due"])
        result,_=self.rate(card_id,3);self.assertEqual(result["card"]["state"],int(State.Review))
        self.now=datetime.fromisoformat(result["card"]["due"])+timedelta(days=20)
        card=Card.from_json(self.row(card_id)["card_json"])
        expected,_=Scheduler(enable_fuzzing=False).review_card(card,Rating.Again,review_datetime=self.now)
        result,_=self.rate(card_id,1);self.assertEqual(result["card"],expected.to_dict());self.assertEqual(expected.state,State.Relearning)
        self.now=expected.due
        result,_=self.rate(card_id,3);self.assertEqual(result["card"]["state"],int(State.Review))

    def test_no_answers_before_reveal_and_revision_token_required(self):
        item=self.add(); front=r.front(item["id"])
        self.assertFalse(front["previously_revealed"])
        self.assertNotIn("answer_markdown",front["question"]);self.assertNotIn("analysis_markdown",front["question"])
        self.assertNotIn("scoring_points",front["question"]);self.assertNotIn("visual",front["question"])
        payload={"revision":0,"rating":4,"request_id":"test-secret","token":"invalid"}
        self.assertEqual(self.client.post(f"/api/reviews/items/{item['id']}/rate",json=payload).status_code,409)
        self.assertEqual(self.client.get(f"/api/reviews/items/{item['id']}/preview?kind=analysis").status_code,403)
        reveal=r.reveal(item["id"],r.Revision(revision=0));self.assertEqual(reveal["question"]["answer_markdown"],"A")
        self.assertTrue(r.front(item["id"])["previously_revealed"])
        self.settings(desired_retention=.95)
        payload["token"]=reveal["token"]
        self.assertEqual(self.client.post(f"/api/reviews/items/{item['id']}/rate",json=payload).status_code,409)
        self.assertEqual(r.history(page=1)["total"],0)

    def test_idempotency_conflict_undo_restores_card_and_daily_count(self):
        item=self.add(); before=r.mutable(self.row(item["id"]))
        result,payload=self.rate(item["id"],4)
        self.assertEqual(r.summary()["ratings"],1)
        self.assertEqual(r.rate(item["id"],payload),result)
        self.assertEqual(r.history(page=1)["total"],1)
        with self.assertRaises(HTTPException):r.rate(item["id"],payload.model_copy(update={"rating":1}))
        r.undo(r.Undo(event_id=result["event_id"]))
        self.assertEqual(r.mutable(self.row(item["id"])),before)
        self.assertEqual(r.summary()["ratings"],0)
        self.assertEqual(r.summary()["ready"],1)
        r.undo(r.Undo(event_id=result["event_id"]))
        self.assertEqual(r.history(page=1)["total"],2)
        with self.assertRaises(HTTPException):r.rate(item["id"],payload)

    def test_undo_does_not_overwrite_subsequent_management(self):
        item=self.add();result,_=self.rate(item["id"],4)
        r.manage(item["id"],r.Manage(revision=1,request_id=uuid.uuid4().hex,action="suspend"))
        with self.assertRaises(HTTPException):r.undo(r.Undo(event_id=result["event_id"]))
        self.assertTrue(self.row(item["id"])["suspended"])

    def test_daily_limits_future_steps_sorting_and_midnight(self):
        self.settings(new_limit=1,review_limit=1)
        a=self.add();self.now+=timedelta(seconds=1);self.insert_question("second");b=self.add("second")
        q=r.queue();self.assertEqual(q["ready_ids"],[a["id"]]);self.assertEqual(q["summary"]["deferred"],1)
        with self.assertRaises(HTTPException):self.rate(b["id"],4)
        result,_=self.rate(a["id"],3);self.assertEqual(r.summary()["upcoming"],1)
        self.assertFalse(r.summary()["completed"])
        with self.assertRaises(HTTPException):self.rate(a["id"],3)
        self.now=datetime.fromisoformat(result["card"]["due"])
        self.rate(a["id"],4)
        self.assertEqual(r.summary()["new_used"],1);self.assertEqual(r.summary()["review_used"],0)
        self.now=datetime(2026,10,10,16,0,tzinfo=timezone.utc)
        self.assertEqual(r.summary()["date"],"2026-10-11")
        self.assertEqual(r.summary()["new_used"],0);self.assertIn(b["id"],r.queue()["ready_ids"])

    def test_timezone_dst_and_postpone_preserves_memory(self):
        item=self.add();original=self.row(item["id"])["card_json"]
        r.manage(item["id"],r.Manage(revision=0,request_id=uuid.uuid4().hex,action="postpone",days=2))
        self.assertEqual(self.row(item["id"])["card_json"],original)
        self.assertEqual(r.summary()["remaining"],0)
        self.assertEqual(self.row(item["id"])["postponed_until"],"2026-10-11T16:00:00+00:00")
        self.settings(timezone="America/Los_Angeles")
        settings=r.get_settings();start,end,date=r.day_bounds(settings,datetime(2026,3,8,12,tzinfo=timezone.utc))
        self.assertEqual(date,"2026-03-08");self.assertEqual((end-start).total_seconds(),23*3600)
        start,end,_=r.day_bounds(settings,datetime(2026,11,1,12,tzinfo=timezone.utc))
        self.assertEqual((end-start).total_seconds(),25*3600)
        self.assertEqual(r.summary()["date"],"2026-10-09")

    def test_suspend_resume_restart_and_snapshot_survives_edits(self):
        item=self.add();payload=r.Manage(revision=0,request_id=uuid.uuid4().hex,action="suspend")
        r.manage(item["id"],payload);r.manage(item["id"],payload)
        self.assertEqual(r.summary()["remaining"],0)
        self.assertEqual(r.list_items(page=1,status="suspended")["total"],1)
        with db.connect() as c:r.init_reviews(c);c.execute("UPDATE questions SET answer_markdown='changed' WHERE id='fixture'")
        r.manage(item["id"],r.Manage(revision=1,request_id=uuid.uuid4().hex,action="resume"))
        self.assertEqual(r.summary()["ready"],1)
        self.assertEqual(r.reveal(item["id"],r.Revision(revision=2))["question"]["answer_markdown"],"A")
        self.assertEqual(self.add()["revision"],2)

    def test_settings_validation_reset_and_reschedule_exact_replay(self):
        current=r.get_settings()
        for invalid in [{"timezone":"bad/timezone"},{"learning_steps":[600,60]},{"maximum_interval":0},{"desired_retention":1}]:
            response=self.client.put("/api/reviews/settings",json={**current,**invalid});self.assertEqual(response.status_code,422)
        item=self.add();self.rate(item["id"],4)
        self.settings(learning_steps=[],relearning_steps=[],maximum_interval=1,desired_retention=.95)
        with db.connect() as c:
            logs=r.optimization_data(c)[0];settings=r.config(c)
        expected=r.scheduler(settings).reschedule_card(Card.from_json(self.row(item["id"])["card_json"]),logs)
        self.assertEqual(r.reschedule(r.Revision(revision=settings["revision"])),{"count":1})
        self.assertEqual(Card.from_json(self.row(item["id"])["card_json"]).to_dict(),expected.to_dict())
        self.assertLessEqual((expected.due-self.now).days,1)
        restored=r.reset_settings(r.Revision(revision=settings["revision"]))
        self.assertEqual(restored["parameters"],list(Scheduler().parameters));self.assertEqual(restored["learning_steps"],[60,600])
        self.assertEqual(r.history(page=1)["total"],2)

    def test_wrong_practice_events_auto_enroll_without_rating(self):
        with db.connect() as c:
            bank=c.execute("SELECT id FROM question_banks WHERE subject='计算机408' LIMIT 1").fetchone()[0]
            c.execute("UPDATE questions SET question_bank_id=? WHERE id='fixture'",(bank,))
        session=start_practice_session(PracticeStartRequest(subject="计算机408",question_bank_id=bank,question_ids=["fixture"],count=1))
        answer_practice_question(session["id"],PracticeAnswerRequest(question_id="fixture",selected_options=["B"]))
        self.assertEqual(r.summary()["total"],1);self.assertEqual(r.summary()["ratings"],0)
        self.assertEqual(r.import_wrong()["added"],0)
        self.insert_question("subjective","solution")
        session=subjective.start(subjective.Start(question_ids=["subjective"],count=1))
        subjective.submit(session["id"],"subjective",subjective.Answer(answer="回忆",revision=0))
        for _ in range(2):subjective.confirm_grade(session["id"],"subjective",subjective.Grade(verdict="incorrect",score=0))
        self.assertEqual(r.summary()["total"],2);self.assertEqual(r.summary()["ratings"],0)
        self.settings(auto_add_wrong=False)
        self.insert_question("not-added")
        with db.connect() as c:r.enroll_wrong(c,self.insert_question("disabled"),"wrong")
        self.assertEqual(r.summary()["total"],2)

    def test_knowledge_card_enroll_deduplicates_and_hints_excluded(self):
        from app.learning import knowledge_cards
        with db.connect() as c:knowledge=knowledge_cards(c)[0]
        item=r.add_item(r.Enroll(source_type="knowledge",source_id=knowledge["id"]))
        self.assertEqual(r.add_item(r.Enroll(source_type="knowledge",source_id=knowledge["id"]))["id"],item["id"])
        result,_=self.rate(item["id"],4,hinted=True)
        self.now=datetime.fromisoformat(result["card"]["due"])
        self.rate(item["id"],4)
        self.assertEqual(r.get_settings()["optimizer_samples"],0)
        self.assertEqual(r.get_settings()["optimizer_excluded_cards"],1)
        self.assertEqual(r.history(page=1)["total"],2)

    def test_migration_backup_restorable_and_once(self):
        path=self.root/"legacy.sqlite"
        with closing(sqlite3.connect(path)) as c:c.execute("CREATE TABLE personal(value TEXT)");c.execute("INSERT INTO personal VALUES('keep')");c.commit()
        r.backup_before_migration(path)
        backups=list((self.root/"backups").glob("legacy-before-reviews*.sqlite3"));self.assertEqual(len(backups),1)
        with closing(sqlite3.connect(backups[0])) as c:self.assertEqual(c.execute("SELECT value FROM personal").fetchone()[0],"keep")
        with closing(sqlite3.connect(path)) as c:r.init_reviews(c);c.commit()
        r.backup_before_migration(path)
        self.assertEqual(len(list((self.root/"backups").glob("legacy-before-reviews*.sqlite3"))),1)

    def test_insufficient_history_never_claims_optimized(self):
        response=self.client.post("/api/reviews/optimize")
        self.assertEqual(response.status_code,422);self.assertIn("512",response.text)
        self.assertIsNone(r.get_settings()["optimization"])

    def test_concurrent_retries_rate_once_and_stale_settings(self):
        item=self.add();reveal=r.reveal(item["id"],r.Revision(revision=0))
        payload=r.Rate(revision=0,token=reveal["token"],rating=4,request_id=uuid.uuid4().hex)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:r.rate(item["id"],payload),range(4)))
        self.assertTrue(all(result==results[0] for result in results))
        self.assertEqual(r.summary()["ratings"],1)
        settings=r.get_settings();self.settings(new_limit=30)
        with self.assertRaises(HTTPException):r.update_settings(r.UpdateSettings(**settings))

    def test_optimization_stale_candidate_and_interrupted_job_preserve_parameters(self):
        settings=r.get_settings()
        with db.connect() as c:
            fingerprint=r.optimization_data(c)[2]
            c.execute("INSERT INTO review_optimizations VALUES(?,?,?,?,?,?,?,NULL)",("candidate","ready",self.now.isoformat(),settings["revision"],fingerprint,512,r.dump(settings["parameters"])))
        self.add();self.rate(1,4)
        with self.assertRaises(HTTPException):r.apply_optimization(r.ApplyOptimization(job_id="candidate"))
        self.assertEqual(r.get_settings()["parameters"],settings["parameters"])
        with db.connect() as c:
            c.execute("UPDATE review_optimizations SET status='running'")
            r.init_reviews(c)
        self.assertEqual(r.get_settings()["optimization"]["status"],"interrupted")

    def test_import_review_routes_keep_original_contract(self):
        self.assertEqual(self.client.get("/api/reviews?page=1").status_code,200)
        self.assertEqual(self.client.get("/api/reviews/queue").status_code,200)
        self.assertEqual(self.client.get("/api/reviews/history").status_code,200)

    def test_real_optimizer_trains_applies_and_replays_512_samples(self):
        # 32 complete card histories, each with 16 non-same-day recall outcomes.
        engine=Scheduler(enable_fuzzing=False)
        base=self.now-timedelta(days=100)
        with db.connect() as c:
            for index in range(32):
                row=r.enroll(c,"question",f"train-{index}",self.question,"optimizer fixture")
                card=Card(card_id=row["id"],due=base)
                for step in range(17):
                    moment=base+timedelta(days=step*3)
                    rating=Rating.Again if (index+step)%5==0 else Rating.Good if step%3 else Rating.Easy
                    after_card,log=engine.review_card(card,rating,review_datetime=moment)
                    before={"card_json":card.to_json(),"due_at":card.due.isoformat(),"suspended":0,"postponed_until":None}
                    after={**before,"card_json":after_card.to_json(),"due_at":after_card.due.isoformat()}
                    r.record(c,row,"rating",uuid.uuid4().hex,{},before,after,rating=int(rating),log=log,settings=r.config(c))
                    card=after_card
                r.write_state(c,row["id"],after)
        self.assertEqual(r.get_settings()["optimizer_samples"],512)
        tasks=BackgroundTasks();job=r.optimize(tasks)
        with db.connect() as c:logs=r.optimization_data(c)[0]
        r.run_optimization(job["id"],logs)
        candidate=r.get_settings()["optimization"]
        self.assertEqual(candidate["status"],"ready",candidate)
        weights=json.loads(candidate["parameters_json"])
        self.assertEqual(len(weights),21);self.assertTrue(all(math.isfinite(w) for w in weights))
        self.assertNotEqual(weights,list(Scheduler().parameters))
        settings=r.apply_optimization(r.ApplyOptimization(job_id=job["id"]))
        self.assertEqual(settings["parameters"],weights)
        self.assertEqual(r.reschedule(r.Revision(revision=settings["revision"]))["count"],32)
        last=self.row(row["id"])
        expected=Scheduler(parameters=weights,enable_fuzzing=False).reschedule_card(Card.from_json(last["card_json"]),[log for log in logs if log.card_id==row["id"]])
        self.assertEqual(Card.from_json(last["card_json"]).to_dict(),expected.to_dict())


if __name__=="__main__":unittest.main()
