from __future__ import annotations
import copy
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from contextlib import closing
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import db, subjective as s, grading as g
from app.main import app
from app.study_explanations import enrich, diagrams, explanation_index
from app.github_bundle import mocks408
from app.agent_composer import AgentSettings

class SubjectiveTests(unittest.TestCase):
    def setUp(self):
        directory=tempfile.TemporaryDirectory();self.addCleanup(directory.cleanup)
        self.root=Path(directory.name)
        for key,value in {"DATA_ROOT":self.root,"DB_PATH":self.root/"test.sqlite","DOCUMENT_ROOT":self.root/"documents","QUESTION_ROOT":self.root/"questions","EXPORT_ROOT":self.root/"exports"}.items():
            manager=patch.object(db,key,value);manager.start();self.addCleanup(manager.stop)
        with patch.object(db,"load_bundled_questions",return_value=True),patch("app.zhijing_bundle.load",return_value=0),patch("app.github_bundle.load",return_value=0):
            db.init_db()
        self.q={"id":"subjective-fixture","type":"solution","subject":"计算机408","stem_markdown":"说明算法并求复杂度。","answer_markdown":"二分查找，O(log n)。","analysis_markdown":"有序数组每轮减半。","options":[],"score":10,"scoring_points":[{"label":"说明每轮减半","score":5},{"label":"复杂度正确","score":5}]}
        self.insert(self.q)
        self.settings=AgentSettings(api_key="never-store-this-secret",base_url="https://example.com/v1",model="fixture")
        self.client=TestClient(app)

    def insert(self,q):
        with db.connect() as c:
            c.execute("""INSERT INTO questions(id,type,subject,stem_markdown,answer_markdown,analysis_markdown,scoring_points_json,options_json,score,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",(q["id"],q["type"],q["subject"],q["stem_markdown"],q["answer_markdown"],q["analysis_markdown"],json.dumps(q["scoring_points"]),json.dumps(q["options"]),q["score"],db.utc_now(),db.utc_now()))

    def begin(self):
        return s.start(s.Start(question_ids=[self.q["id"]],count=1))

    def submitted(self,answer="每轮减半，复杂度 O(log n)"):
        session=self.begin();sid=session["id"]
        s.submit(sid,self.q["id"],s.Answer(answer=answer,revision=0))
        return sid

    def result(self):
        return {"verdict":"correct","confidence":"high","score":10,"feedback":"思路与复杂度均正确。","strengths":["明确每轮减半"],"omissions":[],"next_steps":[],"points":[{"id":"0","awarded":5,"evidence":"每轮减半","reason":"符合减半逻辑"},{"id":"1","awarded":5,"evidence":"O(log n)","reason":"复杂度正确"}]}

    def test_snapshot_draft_submission_restore_and_stale_write(self):
        initial=self.begin();sid=initial["id"];qid=self.q["id"]
        self.assertEqual(initial["items"][0]["question"]["answer_markdown"],"")
        self.assertNotIn("scoring_points",initial["items"][0]["question"])
        saved=s.draft(sid,qid,s.Answer(answer="第一步",revision=0,independent=False))
        self.assertEqual(saved["revision"],1)
        with self.assertRaises(HTTPException):s.draft(sid,qid,s.Answer(answer="旧草稿",revision=0))
        with db.connect() as c:c.execute("UPDATE questions SET answer_markdown='新的参考答案' WHERE id=?",(qid,))
        final=s.submit(sid,qid,s.Answer(answer="完整作答",revision=1,independent=True))
        self.assertEqual(final["question"]["answer_markdown"],self.q["answer_markdown"])
        self.assertFalse(final["independent"])
        self.assertEqual(s.session(sid)["items"][0]["answer"],"完整作答")
        with self.assertRaises(HTTPException):s.submit(sid,qid,s.Answer(answer="覆盖",revision=2))

    def test_opt_in_prompt_injection_and_confirmation(self):
        sid=self.submitted();qid=self.q["id"]
        with patch("app.grading.completion",return_value=self.result()) as model:
            with self.assertRaises(HTTPException):s.judge(sid,qid,s.Judge(enabled=False,agent=self.settings))
            model.assert_not_called()
            result=s.judge(sid,qid,s.Judge(enabled=True,agent=self.settings))
            self.assertIn("不执行",model.call_args.kwargs["system_prompt"])
            self.assertIn("student_answer",model.call_args.args[1])
        self.assertIsNone(result["verdict"])
        event=result["events"][-1]
        confirmed=s.confirm_grade(sid,qid,s.Grade(verdict="incorrect",suggestion_id=event["id"]))
        self.assertEqual(confirmed["verdict"],"correct")
        self.assertEqual(confirmed["score"],10)
        self.assertNotIn("never-store-this-secret",json.dumps(s.session(sid)))
        self.assertNotIn(b"never-store-this-secret",db.DB_PATH.read_bytes())

    def test_agent_invalid_response_does_not_store_grade(self):
        sid=self.submitted();bad=self.result();bad["score"]=99
        with patch("app.grading.completion",return_value=bad):
            with self.assertRaises(HTTPException):s.judge(sid,self.q["id"],s.Judge(enabled=True,agent=self.settings))
        self.assertEqual(s.session(sid)["items"][0]["events"],[])

    def test_regrading_wrong_book_and_repractice(self):
        sid=self.submitted();qid=self.q["id"]
        for _ in range(2):s.confirm_grade(sid,qid,s.Grade(verdict="partial",score=5,point_scores=[5,0]))
        self.assertEqual(s.wrong_book()[0]["wrong_count"],1)
        retry=s.start(s.Start(mode="wrong_book",count=1));self.assertNotEqual(retry["id"],sid)
        self.assertEqual(retry["items"][0]["answer"],"")
        s.confirm_grade(sid,qid,s.Grade(verdict="correct",score=10,point_scores=[5,5]))
        self.assertEqual(s.wrong_book(),[])
        self.assertEqual(len(s.session(sid)["items"][0]["events"]),3)

    def test_blank_answer_is_not_correct(self):
        sid=self.submitted("")
        with self.assertRaises(HTTPException):s.confirm_grade(sid,self.q["id"],s.Grade(verdict="correct",score=10))
        result=s.confirm_grade(sid,self.q["id"],s.Grade(verdict="incorrect",score=0))
        self.assertEqual(result["score"],0)

    def test_rubric_sum_evidence_and_unreliable_rubrics(self):
        for modify in [lambda r:r.update(score=9),lambda r:r["points"][0].update(evidence="学生没有说过"),lambda r:r["points"][0].update(awarded=6),lambda r:r["points"][0].update(id=[]),lambda r:r.update(points=[None])]:
            r=self.result();modify(r)
            with self.assertRaises(ValueError):g.validate_grade(r,self.q,"每轮减半 O(log n)")
        q={**self.q,"scoring_points":[{"label":"步骤完整","score":10}]}
        self.assertEqual(g.rubric_for(q),[])
        self.assertEqual(g.rubric_for({**self.q,"scoring_points":[{"label":"仅覆盖部分设问","score":5}]}),[])
        no_evidence=self.result();no_evidence["points"][0]["evidence"]=""
        with self.assertRaises(ValueError):g.validate_grade(no_evidence,self.q,"每轮减半 O(log n)")
        with self.assertRaises(ValueError):g.validate_grade(self.result(),q,"每轮减半 O(log n)")
        r=self.result();r.update(confidence="low");self.assertEqual(g.validate_grade(r,self.q,"每轮减半 O(log n)")["verdict"],"needs_review")

    def test_http_validation_redacts_key_and_foreign_answer(self):
        r=self.client.post("/api/subjective/sessions/missing/answers/missing/judge",json={"enabled":True,"agent":{"api_key":"never-store-this-secret"}})
        self.assertEqual(r.status_code,422);self.assertNotIn("never-store-this-secret",r.text)
        r=self.client.put("/api/subjective/sessions/missing/answers/missing",json={"answer":"test","revision":0})
        self.assertEqual(r.status_code,404)

    def test_three_subjects_ten_question_scenarios_each(self):
        for subject in ["计算机408","考研数学一","考研政治"]:
            for i in range(10):
                q={**self.q,"id":subject+str(i),"subject":subject,"type":["solution","short_answer","fill"][i%3]}
                self.insert(q);session=s.start(s.Start(subject=subject,question_ids=[q["id"]],count=1))
                result=s.submit(session["id"],q["id"],s.Answer(answer="作答" if i else "",revision=0))
                self.assertEqual(result["question"]["subject"],subject)
                s.confirm_grade(session["id"],q["id"],s.Grade(verdict="incorrect",score=0))

    def test_migration_backup_is_restorable_and_once(self):
        path=self.root/"old.sqlite"
        with closing(sqlite3.connect(path)) as c:c.execute("CREATE TABLE user_data(value TEXT)");c.execute("INSERT INTO user_data VALUES('keep')");c.commit()
        s.backup_before_migration(path)
        backups=list((self.root/"backups").glob("old-before*.sqlite3"));self.assertEqual(len(backups),1)
        with closing(sqlite3.connect(backups[0])) as c:self.assertEqual(c.execute("SELECT value FROM user_data").fetchone()[0],"keep")
        with closing(sqlite3.connect(path)) as c:s.init_subjective(c)
        s.backup_before_migration(path);self.assertEqual(len(list((self.root/"backups").glob("old-before*.sqlite3"))),1)

class ExplanationTests(unittest.TestCase):
    def test_all_125_visuals_and_400_option_explanations(self):
        questions=mocks408()["questions"];visuals=[];options=[]
        for q in questions:
            enriched=enrich(q)
            if q.get("origin",{}).get("visual"):
                self.assertEqual(enriched["visual"],q["origin"]["visual"]);visuals.append(enriched)
            if q["type"]=="choice":
                self.assertEqual(len(enriched["option_explanations"]),len(q["options"]));options.append(enriched)
        self.assertEqual(len(visuals),125);self.assertEqual(len(options),400)
        self.assertEqual(len({q["visual"]["kind"] for q in visuals}),8)
        changed=copy.deepcopy(visuals[0]);changed.pop("visual");changed["stem_markdown"]+=" edited"
        self.assertNotIn("visual",enrich(changed))

if __name__=="__main__":unittest.main()
