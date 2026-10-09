import hashlib
import json
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import db
from app.github_bundle import ROOT, manifest, load, preview


class GithubBundleTests(unittest.TestCase):
    def test_all_answers_tags_assets_and_provenance(self):
        data = manifest()
        self.assertTrue(data.get("ready"))
        self.assertEqual(len(data["questions"]), sum(data["counts"].values()))
        ids = set()
        for question in data["questions"]:
            self.assertNotIn(question["id"], ids)
            ids.add(question["id"])
            self.assertTrue(question["answer_markdown"].strip())
            self.assertGreaterEqual(len(question["tags"]), 2)
            self.assertTrue(question["origin"]["repository"].startswith("https://github.com/"))
            if question["type"] == "choice":
                self.assertTrue(set(question["answer_markdown"]) <= {o["key"] for o in question["options"]})
            if question["render"]:
                self.assertEqual(set(question["previews"]), {"question", "analysis"})
            for item in question["previews"].values():
                self.assertEqual(hashlib.sha256((ROOT / item["file"]).read_bytes()).hexdigest(), item["sha256"])
        self.assertEqual(len(ids), 3577)

    def test_incremental_load_and_preserved_edits(self):
        with sqlite3.connect(":memory:") as connection, db.connect() as current:
            current.backup(connection)
            connection.execute("DELETE FROM questions WHERE id LIKE 'github-%'")
            connection.execute("DELETE FROM app_metadata WHERE key='github_study_supplement_v1_initialized'")
            self.assertEqual(load(connection), 3577)
            first = manifest()["questions"][0]
            connection.execute("UPDATE questions SET stem_markdown='edited' WHERE id=?", (first["id"],))
            self.assertEqual(load(connection), 0)
            self.assertEqual(connection.execute("SELECT stem_markdown FROM questions WHERE id=?", (first["id"],)).fetchone()[0], "edited")
            self.assertTrue(preview(first, "question"))
            self.assertFalse(connection.execute("PRAGMA foreign_key_check").fetchall())

    def test_408_comprehensive_questions_and_full_paper(self):
        from app.github_bundle import solutions408
        from app.composer import compose_paper
        data = solutions408()
        self.assertEqual(len(data["questions"]), 117)
        self.assertEqual(len(data["excluded"]), 2)
        for q in data["questions"]:
            self.assertEqual(q["type"], "solution")
            self.assertTrue(q["answer_markdown"].strip())
            for item in q["previews"].values():
                self.assertEqual(hashlib.sha256((ROOT/item["file"]).read_bytes()).hexdigest(), item["sha256"])
        with sqlite3.connect(":memory:") as connection, db.connect() as current:
            current.backup(connection)
            connection.row_factory = sqlite3.Row
            template = db.row_to_template(connection.execute("SELECT * FROM templates WHERE id='template-408-full'").fetchone())
            paper = compose_paper(connection, template, 408, "408 comprehensive regression")
            self.assertTrue(paper["validation"]["valid"])
            self.assertEqual(sum(q["type"] == "solution" for q in paper["questions"]), 5)
            self.assertTrue(all(q["answer_markdown"] for q in paper["questions"]))

    def test_mock_papers_answers_tags_and_composition(self):
        from collections import Counter
        from app.github_bundle import mocks408
        from app.composer import compose_paper
        data = mocks408()
        self.assertEqual(len(data["questions"]), 470)
        papers = {}
        for q in data["questions"]:
            papers.setdefault(q["origin"]["paper"], []).append(q)
            self.assertIn("模拟题", q["tags"])
            self.assertTrue(q["answer_markdown"])
            if q["type"] == "choice":
                self.assertIn(q["answer_markdown"], [o["key"] for o in q["options"]])
            for item in q["previews"].values():
                self.assertEqual(hashlib.sha256((ROOT/item["file"]).read_bytes()).hexdigest(), item["sha256"])
        self.assertEqual(len(papers), 10)
        for items in papers.values():
            self.assertEqual(Counter(q["type"] for q in items), {"choice":40,"solution":7})
            self.assertEqual(sum(q["score"] for q in items), 150)
        with sqlite3.connect(":memory:") as connection, db.connect() as current:
            current.backup(connection)
            connection.row_factory = sqlite3.Row
            template = db.row_to_template(connection.execute("SELECT * FROM templates WHERE id='template-408-full'").fetchone())
            for section in template["sections"]:
                section.setdefault("filters", {}).setdefault("tags", []).append("模拟题")
            paper = compose_paper(connection, template, 41, "mock-only")
            self.assertTrue(paper["validation"]["valid"])
            self.assertTrue(all("模拟题" in q["tags"] for q in paper["questions"]))
