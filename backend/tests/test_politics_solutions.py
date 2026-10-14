"""Acceptance of real politics solution data, classification and paired exports."""
from collections import Counter
import hashlib
import io
import json
import re
import sqlite3
import unittest
import zipfile

from fastapi.testclient import TestClient
import test_learning_agent as fixtures
from app import db
from app.github_bundle import load_batch, politics_solutions
from app.politics import POLITICS_MAJORS, normalize_politics_tags
from app.composer import compose_paper
from app.main import app
from app import paper_package as package

KEY = "github_politics_solutions_v1_initialized"


class PoliticsSolutionsTests(unittest.TestCase):
    setUp = fixtures.LearningAgentTests.setUp

    def load(self):
        with db.connect() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            return load_batch(connection, politics_solutions(), KEY)

    def test_materials_answers_classification_provenance_and_duplicates(self):
        data = politics_solutions()
        self.assertEqual(len(data["questions"]), 30)
        self.assertEqual(sum(data["counts"].values()), 30)
        self.assertEqual(set(data["counts"]), set(POLITICS_MAJORS))
        seen = set()
        for q in data["questions"]:
            origin = q["origin"]
            identity = (origin["year"], origin["number"])
            self.assertNotIn(identity, seen)
            seen.add(identity)
            self.assertEqual(q["type"], "solution")
            self.assertEqual(q["question_bank_id"], "bank-politics")
            self.assertEqual(q["tags"][0], POLITICS_MAJORS[origin["number"] - 34])
            self.assertEqual(list(normalize_politics_tags(q["stem_markdown"], q["chapter"], q["knowledge_points"], q["tags"][0])), q["tags"])
            stem = q["stem_markdown"].split("\n\n", 1)[1]
            self.assertGreater(len(stem), 150)
            self.assertGreater(len(q["answer_markdown"]), 120)
            self.assertNotRegex(stem, r"【(?:解析|参考答案|答案要点)】")
            self.assertNotIn("找研讯", stem + q["answer_markdown"])
            self.assertIn(origin["commit"], q["analysis_markdown"])
            self.assertEqual(hashlib.sha256((stem + "\n" + q["answer_markdown"]).encode()).hexdigest(), origin["content_sha256"])
            self.assertEqual(q["source_page"], None)
            self.assertEqual(q["score"], 10)
        exclusions = {(e["source"], e["year"], e["number"]) for e in data["excluded"]}
        self.assertIn(("tseka", 2022, 34), exclusions)
        self.assertIn(("xyz", 2012, 34), exclusions)
        self.assertIn(("xyz", 2018, 35), exclusions)

    def test_incremental_load_keeps_edits_deletions_and_existing_records(self):
        with db.connect() as connection:
            previous = [tuple(row) for row in connection.execute("SELECT * FROM questions ORDER BY id")]
        self.assertEqual(self.load(), 30)
        first, second = politics_solutions()["questions"][:2]
        with db.connect() as connection:
            self.assertEqual([tuple(row) for row in connection.execute("SELECT * FROM questions WHERE id NOT LIKE 'github-politicssolution-%' ORDER BY id")], previous)
            connection.execute("UPDATE questions SET stem_markdown='我的修改' WHERE id=?", (first["id"],))
            connection.execute("DELETE FROM questions WHERE id=?", (second["id"],))
        self.assertEqual(self.load(), 0)
        with db.connect() as connection:
            self.assertEqual(connection.execute("SELECT stem_markdown FROM questions WHERE id=?", (first["id"],)).fetchone()[0], "我的修改")
            self.assertIsNone(connection.execute("SELECT id FROM questions WHERE id=?", (second["id"],)).fetchone())
            self.assertFalse(connection.execute("PRAGMA foreign_key_check").fetchall())

    def make_paper(self):
        self.load()
        with db.connect() as connection:
            template = db.row_to_template(connection.execute("SELECT * FROM templates WHERE question_bank_id='bank-politics'").fetchone())
            template["sections"] = [dict(id=f"politics-{i}", title=major, type="solution", count=1, score=10,
                                         filters={"tags": [major]}) for i, major in enumerate(POLITICS_MAJORS)]
            template["total_score"] = 50
            paper = compose_paper(connection, template, 2024, "政治五模块分析题验收")
        self.assertTrue(paper["validation"]["valid"])
        self.assertEqual(Counter(q["tags"][0] for q in paper["questions"]), {m: 1 for m in POLITICS_MAJORS})
        return paper

    def test_five_module_composition_and_real_word_answer_booklet(self):
        paper = self.make_paper()
        prepared = package.prepare(paper["id"], package.Prepare(format="docx"))
        self.assertEqual(prepared["issues"], [])
        package.build(paper["id"], prepared["version"], package.Build())
        download = TestClient(app).get("/api/exports/" + prepared["version"] + "/download")
        self.assertEqual(download.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            self.assertEqual(len(archive.namelist()), 2)
            for name in archive.namelist():
                with zipfile.ZipFile(io.BytesIO(archive.read(name))) as doc:
                    xml = doc.read("word/document.xml").decode()
                self.assertIn(prepared["version"], xml)
                self.assertEqual("答案：" in xml, "答案册" in name)
                for q in paper["questions"]:
                    self.assertIn(str(q["source_question_number"]), xml)
                    if "答案册" in name:
                        self.assertIn(q["answer_markdown"][:18], xml)
                    else:
                        self.assertNotIn(q["answer_markdown"][:18], xml)

    def test_real_pdf_package_contains_readable_chinese_questions_and_answers(self):
        import fitz
        paper = self.make_paper()
        prepared = package.prepare(paper["id"], package.Prepare(format="pdf"))
        self.assertEqual(prepared["issues"], [])
        package.build(paper["id"], prepared["version"], package.Build())
        response = TestClient(app).get("/api/exports/" + prepared["version"] + "/download")
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            for name in archive.namelist():
                with fitz.open(stream=archive.read(name), filetype="pdf") as doc:
                    text = re.sub(r"\s+", "", "".join(page.get_text() for page in doc))
                    self.assertGreater(doc.page_count, 0)
                    self.assertIn("政治五模块分析题验收", text)
                    for q in paper["questions"]:
                        snippet = re.sub(r"\s+", "", q["answer_markdown"][:20])
                        self.assertEqual(snippet in text, "答案册" in name)

    def test_practice_filter_hides_answer_until_submission(self):
        self.load()
        client = TestClient(app)
        for chapter in {q["chapter"] for q in politics_solutions()["questions"]}:
            response = client.post("/api/subjective/sessions", json={
                "subject": "考研政治", "chapter": chapter, "question_type": "solution", "count": 1,
            })
            self.assertEqual(response.status_code, 200)
            session = response.json()
            item = session["items"][0]
            self.assertEqual(item["question"]["chapter"], chapter)
            self.assertEqual(item["question"]["answer_markdown"], "")
            self.assertEqual(item["question"]["analysis_markdown"], "")
            submitted = client.post("/api/subjective/sessions/" + session["id"] + "/answers/" + item["question"]["id"] + "/submit",
                                    json={"answer": "结合材料与所学原理分析。", "revision": item["revision"], "independent": True})
            self.assertEqual(submitted.status_code, 200)
            self.assertGreater(len(submitted.json()["question"]["answer_markdown"]), 120)
            self.assertIn("github.com", submitted.json()["question"]["analysis_markdown"])
