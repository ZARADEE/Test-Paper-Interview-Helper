from __future__ import annotations

import hashlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import db
from app.question_bundle import BUNDLE_ROOT, QUESTION_ROOT, bundle_manifest, bundled_preview
from app.zhijing_bundle import manifest as manifest_408, ROOT as ROOT_408


class QuestionBundleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        for name, value in {
            "DATA_ROOT": root, "DB_PATH": root / "test.sqlite3",
            "DOCUMENT_ROOT": root / "documents", "QUESTION_ROOT": root / "questions",
            "EXPORT_ROOT": root / "exports",
        }.items():
            manager = patch.object(db, name, value)
            manager.start()
            self.addCleanup(manager.stop)
        self.manifest = bundle_manifest()
        self.assertTrue(self.manifest, "Generate the question bundle before running tests")
        manager = patch("app.github_bundle.load", return_value=0)
        manager.start()
        self.addCleanup(manager.stop)
        db.init_db()

    def test_fresh_database_restores_all_questions_and_templates(self):
        with db.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM questions").fetchone()[0], self.manifest["counts"]["questions"] + 1624)
            counts = {row[0]: row[1] for row in connection.execute("SELECT subject,COUNT(*) FROM questions GROUP BY subject")}
            self.assertEqual(counts, {**self.manifest["counts"]["by_subject"], "计算机408": 1624})
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM templates").fetchone()[0], len(self.manifest["templates"]) + 1)
            self.assertFalse(connection.execute("PRAGMA foreign_key_check").fetchall())
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM source_documents WHERE file_path!=''").fetchone()[0], 0)

    def test_408_default_optional_suite_and_images(self):
        from app.presets import install_408
        from app.template_rules import template_errors
        with db.connect() as connection:
            templates = connection.execute("SELECT * FROM templates WHERE question_bank_id='bank-computer-408'").fetchall()
            self.assertEqual([t["id"] for t in templates], ["template-408-full"])
            self.assertFalse(template_errors(db.row_to_template(templates[0])))
            first = manifest_408()["questions"][0]
            question = db.row_to_question(connection.execute("SELECT * FROM questions WHERE id=?", (first["id"],)).fetchone())
            self.assertEqual(question["tags"], first["tags"])
        self.assertEqual(len(install_408()), 6)
        self.assertEqual(len(install_408()), 6)
        count = 0
        for question in manifest_408()["questions"]:
            self.assertTrue(question["answer_markdown"])
            for item in question["previews"].values():
                self.assertEqual(hashlib.sha256((ROOT_408 / item["file"]).read_bytes()).hexdigest(), item["sha256"])
                count += 1
        self.assertEqual(count, 1641)
        self.assertTrue(bundled_preview(first, "analysis"))
        with db.connect() as connection:
            connection.execute("UPDATE templates SET name='edited' WHERE id='template-408-topic-0'")
            connection.execute("DELETE FROM questions WHERE id=?", (first["id"],))
        db.init_db()
        with db.connect() as connection:
            self.assertIsNone(connection.execute("SELECT id FROM questions WHERE id=?", (first["id"],)).fetchone())
            self.assertEqual(connection.execute("SELECT name FROM templates WHERE id='template-408-topic-0'").fetchone()[0], 'edited')

    def test_short_answers_preserve_all_origins_and_compose_separately(self):
        from app.zhijing_bundle import short_answers
        from app.composer import compose_paper
        from app.template_rules import template_errors
        data = short_answers()
        self.assertEqual(len(data["occurrences"]), 87)
        self.assertEqual(len(data["questions"]), 48)
        self.assertEqual(sum(len(q["origins"]) for q in data["questions"]), 87)
        image_question = next(q for q in data["questions"] if q["previews"])
        self.assertTrue(bundled_preview(image_question, "analysis"))
        with db.connect() as connection:
            template = db.row_to_template(connection.execute("SELECT * FROM templates WHERE id='template-408-full'").fetchone())
            template["sections"] = [{"id": "short", "title": "简答题", "type": "short_answer", "count": 3, "score": 5}]
            template["total_score"] = 15
            self.assertFalse(template_errors(template))
            paper = compose_paper(connection, template, 19, "short-answer-test")
            self.assertEqual(len(paper["questions"]), 3)
            self.assertTrue(all(q["type"] == "short_answer" for q in paper["questions"]))
            self.assertTrue(paper["validation"]["valid"])
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM questions WHERE type='short_answer'").fetchone()[0], 48)

    def test_restart_keeps_edits_and_does_not_restore_deleted_questions(self):
        first, second = [entry["id"] for entry in self.manifest["questions"][:2]]
        with db.connect() as connection:
            connection.execute("UPDATE questions SET stem_markdown='local edit' WHERE id=?", (first,))
            connection.execute("DELETE FROM questions WHERE id=?", (second,))
        db.init_db()
        with db.connect() as connection:
            self.assertEqual(connection.execute("SELECT stem_markdown FROM questions WHERE id=?", (first,)).fetchone()[0], "local edit")
            self.assertIsNone(connection.execute("SELECT id FROM questions WHERE id=?", (second,)).fetchone())

    def test_previews_and_export_work_without_original_pdf(self):
        from PIL import Image
        from app.exporters import source_preview
        from app.main import question_preview
        samples = {}
        with db.connect() as connection:
            for entry in self.manifest["questions"]:
                if len(entry["previews"]) != 2:
                    continue
                row = connection.execute("SELECT * FROM questions WHERE id=?", (entry["id"],)).fetchone()
                samples.setdefault(row["subject"], db.row_to_question(row))
        self.assertEqual(len(samples), 2)
        for question in samples.values():
            for kind in ("question", "analysis"):
                with self.subTest(subject=question["subject"], kind=kind):
                    content = bundled_preview(question, kind)
                    self.assertTrue(content)
                    with Image.open(io.BytesIO(content)) as image:
                        self.assertEqual(image.format, "PNG")
                        self.assertGreater(image.width, 20)
                    self.assertEqual(source_preview(question, kind), content)
                    response = question_preview(question["id"], kind)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.body, content)
            changed = {**question, "source_page": 99999}
            self.assertIsNone(bundled_preview(changed, "question"), "Changed source must not use an old crop")

    def test_every_bundled_file_matches_its_checksum(self):
        preview_count = 0
        for entry in self.manifest["questions"]:
            content = (QUESTION_ROOT / (entry["id"] + ".json")).read_bytes()
            self.assertEqual(hashlib.sha256(content).hexdigest(), entry["sha256"], entry["id"])
            for image in entry["previews"].values():
                content = (BUNDLE_ROOT / image["file"]).read_bytes()
                self.assertEqual(hashlib.sha256(content).hexdigest(), image["sha256"], image["file"])
                preview_count += 1
        self.assertEqual(preview_count, self.manifest["counts"]["previews"])


if __name__ == "__main__":
    unittest.main()
