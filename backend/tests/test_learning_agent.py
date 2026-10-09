from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import db
from app.agent_composer import AgentSettings, completion, plan_paper
from app.composer import compose_paper, load_paper
from app.template_rules import template_errors
from app.template_rules import matches_section
from app.learning import Reflection, get_note, save_note, overview, Discussion, discuss, discussions, react
from app.presets import install_408
from app.main import ComposeRequest, compose, PracticeStartRequest, start_practice, PracticeAnswerRequest, answer_practice_question, get_practice_session
from fastapi import HTTPException


class LearningAgentTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        for name, value in {"DATA_ROOT": root, "DB_PATH": root / "test.sqlite", "DOCUMENT_ROOT": root / "documents", "QUESTION_ROOT": root / "questions", "EXPORT_ROOT": root / "exports"}.items():
            manager = patch.object(db, name, value)
            manager.start(); self.addCleanup(manager.stop)
        with patch.object(db, "load_bundled_questions", return_value=True), patch("app.zhijing_bundle.load", return_value=0), patch("app.github_bundle.load", return_value=0):
            db.init_db()
        templates = install_408()
        self.template = next(t for t in templates if t["id"] == "template-408-choice")
        self.template["sections"] = [
            {"id": "ds", "title": "数据结构", "type": "choice", "count": 2, "score": 2, "filters": {"tags": ["数据结构"]}},
            {"id": "os", "title": "操作系统", "type": "choice", "count": 2, "score": 2, "filters": {"tags": ["操作系统"]}},
        ]
        self.template["total_score"] = 8
        with db.connect() as connection:
            connection.execute("UPDATE templates SET total_score=8,sections_json=? WHERE id=?", (json.dumps(self.template["sections"]), self.template["id"]))
            for prefix, major in [("ds", "数据结构"), ("os", "操作系统")]:
                for i in range(4):
                    connection.execute("""INSERT INTO questions(id,type,subject,question_bank_id,stem_markdown,options_json,answer_markdown,analysis_markdown,tags_json,knowledge_points_json,chapter,difficulty,score,review_status,created_at,updated_at)
                        VALUES(?, 'choice', '计算机408', 'bank-computer-408', '测试题', ?, 'A', '测试解析', ?, ?, ?, 'medium', 2, 'approved', ?, ?)""",
                        (f"{prefix}{i}", json.dumps([{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}]), json.dumps([major, "基础"]), json.dumps(["基础知识"]), major, db.utc_now(), db.utc_now()))
        self.settings = AgentSettings(api_key="secret-test", base_url="https://example.com/v1", model="test-model")

    def test_local_filters_repeatability_and_unique_paper_ids(self):
        with db.connect() as connection:
            first = compose_paper(connection, self.template, 7, "test")
            second = compose_paper(connection, self.template, 7, "test")
            self.assertEqual([q["id"] for q in first["questions"]], [q["id"] for q in second["questions"]])
            self.assertNotEqual(first["id"], second["id"])
            self.assertTrue(first["validation"]["valid"])
            self.assertTrue(all(q["id"].startswith(q["section_id"]) for q in first["questions"]))
            self.assertEqual([q["section_id"] for q in load_paper(connection, first["id"])["questions"]], ["ds", "ds", "os", "os"])

    def test_agent_accepts_only_valid_section_ids(self):
        valid = {"sections": {"ds": ["ds0", "ds1"], "os": ["os0", "os1"]}, "rationale": "覆盖两个科目"}
        with db.connect() as connection, patch("app.agent_composer.completion", return_value=valid):
            plan, reason = plan_paper(connection, self.template, 1, [], [], self.settings)
            paper = compose_paper(connection, self.template, 1, "agent", selection_plan=plan)
            self.assertEqual(len(paper["questions"]), 4)
            self.assertEqual(reason, valid["rationale"])
        for ids in (["ds0", "ds0"], ["os0", "ds1"], ["invented", "ds1"], ["ds0"]):
            bad = copy.deepcopy(valid); bad["sections"]["ds"] = ids
            with self.subTest(ids=ids), db.connect() as connection, patch("app.agent_composer.completion", return_value=bad):
                with self.assertRaises(ValueError):
                    plan_paper(connection, self.template, 1, [], [], self.settings)

    def test_shortage_does_not_call_model(self):
        template = copy.deepcopy(self.template); template["sections"][0]["count"] = 99
        with db.connect() as connection, patch("app.agent_composer.completion") as call:
            with self.assertRaises(ValueError):
                plan_paper(connection, template, 1, [], [], self.settings)
            call.assert_not_called()

    def test_switch_off_never_calls_agent_and_on_requires_key(self):
        with patch("app.main.plan_paper") as call:
            compose(ComposeRequest(template_id=self.template["id"], agent=self.settings))
            call.assert_not_called()
        with db.connect() as connection:
            connection.execute("UPDATE templates SET distribution_rules_json=? WHERE id=?", (json.dumps({"agent_enabled": True}), self.template["id"]))
        with self.assertRaises(HTTPException) as error:
            compose(ComposeRequest(template_id=self.template["id"]))
        self.assertEqual(error.exception.status_code, 422)

    def test_credentials_and_invalid_template_rejected(self):
        self.assertNotIn("secret-test", repr(self.settings))
        self.assertFalse(template_errors(self.template))
        for patch_value in ({"agent_enabled": "false"}, {"api_key": "secret"}):
            template = {**self.template, "distribution_rules": patch_value}
            self.assertTrue(template_errors(template))
        template = copy.deepcopy(self.template); template["sections"][0]["count"] = -1
        self.assertTrue(template_errors(template))

    def test_private_or_insecure_model_endpoint_rejected(self):
        for url in ("http://example.com/v1", "https://user:pass@example.com/v1", "https://127.0.0.1/v1"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                completion(self.settings.model_copy(update={"base_url": url}), {})

    def test_reflection_history_targeted_practice_and_resume(self):
        session = start_practice(PracticeStartRequest(subject="计算机408", question_bank_id="bank-computer-408", question_ids=["ds0", "os0"], count=2))
        self.assertEqual({q["id"] for q in session["questions"]}, {"ds0", "os0"})
        self.assertTrue(all(not q["answer_markdown"] for q in session["questions"]))
        result = answer_practice_question(session["id"], PracticeAnswerRequest(question_id="ds0", selected_options=["B"]))
        self.assertFalse(result["correct"])
        save_note("ds0", Reflection(favorite=True, cause="概念不清", note="复习基础"))
        self.assertTrue(get_note("ds0")["favorite"])
        restored = get_practice_session(session["id"])
        answered = next(q for q in restored["questions"] if q["id"] == "ds0")
        self.assertEqual(answered["analysis_markdown"], "测试解析")
        self.assertTrue(answered["attempt"])
        data = overview()
        self.assertIn("ds0", data["favorites"])
        self.assertEqual(data["stats"], {"attempts": 1, "correct": 0})
        card = next(c for c in data["cards"] if "ds0" in c["question_ids"])
        self.assertEqual(card["attempts"], 1)
        items = discuss(card["id"], Discussion(nickname="测试", body="问题"))
        react(items[0]["id"], "like")
        self.assertEqual(discussions(card["id"])[0]["liked"], 1)
        react(items[0]["id"], "report")
        self.assertEqual(discussions(card["id"]), [])

    def test_single_multiple_choice_constraints(self):
        q = {"type": "choice", "answer_markdown": "AB", "tags": []}
        section = {"type": "choice", "filters": {"answer_mode": "single"}}
        self.assertFalse(matches_section(q, section, []))
        section["filters"]["answer_mode"] = "multiple"
        self.assertTrue(matches_section(q, section, []))

    def test_model_transport_and_errors_never_echo_secret(self):
        from unittest.mock import MagicMock
        from urllib.error import HTTPError
        public = [(2, 1, 6, "", ("93.184.216.34", 443))]
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({"choices": [{"message": {"content": json.dumps({"sections": {}})}}]}).encode()
        opener = MagicMock(); opener.open.return_value = response
        with patch("app.agent_composer.socket.getaddrinfo", return_value=public), patch("app.agent_composer.build_opener", return_value=opener):
            self.assertEqual(completion(self.settings, {}), {"sections": {}})
            request = opener.open.call_args.args[0]
            self.assertEqual(request.full_url, "https://example.com/v1/chat/completions")
            self.assertEqual(request.headers["Authorization"], "Bearer secret-test")
            opener.open.side_effect = HTTPError(request.full_url, 401, "secret-test", {}, None)
            with self.assertRaises(ValueError) as error:
                completion(self.settings, {})
            self.assertNotIn("secret-test", str(error.exception))
            self.assertIn("401", str(error.exception))

    def test_text_only_exports(self):
        from app.exporters import export_pdf, export_docx
        import fitz
        from docx import Document
        with db.connect() as connection:
            paper = compose_paper(connection, self.template, 1, "Text export")
        paper["questions"][0]["stem_markdown"] = "Visible question text"
        paper["questions"][0]["answer_markdown"] = "HIDDEN-ANSWER"
        for variant in ("question", "answer"):
            pdf = db.DATA_ROOT / f"{variant}.pdf"
            export_pdf(paper, variant, pdf)
            with fitz.open(pdf) as document:
                text = str([page.get_text() for page in document])
            self.assertIn("Visible question text", text)
            self.assertEqual("HIDDEN-ANSWER" in text, variant == "answer")
            docx = db.DATA_ROOT / f"{variant}.docx"
            export_docx(paper, variant, docx)
            text = str([p.text for p in Document(docx).paragraphs])
            self.assertIn("Visible question text", text)
            self.assertEqual("HIDDEN-ANSWER" in text, variant == "answer")

    def test_presets_idempotent_and_valid(self):
        templates = install_408()
        self.assertEqual(len(templates), 6)
        self.assertEqual(len(install_408()), 6)
        for template in templates:
            self.assertFalse(template_errors(template), template["name"])


if __name__ == "__main__":
    unittest.main()
