import json
import unittest
from unittest.mock import patch
import test_learning_agent as fixtures
from app import db
from app.presets import install_408, repair_legacy_presets
from app.main import QuestionCreate, create_question, list_tags


class LegacyIntegrationTests(unittest.TestCase):
    setUp = fixtures.LearningAgentTests.setUp
    def legacy_schema(self):
        with db.connect() as connection:
            connection.executescript('''
                CREATE TABLE templates_legacy (
                    id TEXT PRIMARY KEY,name TEXT NOT NULL,subject TEXT NOT NULL,
                    duration_minutes INTEGER NOT NULL,total_score REAL NOT NULL,
                    sections_json TEXT NOT NULL,distribution_rules_json TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,question_bank_id TEXT
                );
                INSERT INTO templates_legacy SELECT id,name,subject,duration_minutes,total_score,sections_json,distribution_rules_json,version,created_at,updated_at,question_bank_id FROM templates;
                DROP TABLE templates;
                ALTER TABLE templates_legacy RENAME TO templates;
            ''')

    def test_install_on_migrated_schema_and_repair_exact_corruption(self):
        self.legacy_schema()
        with db.connect() as connection:
            connection.execute("DELETE FROM templates WHERE id LIKE 'template-408-%'")
        templates = install_408()
        self.assertEqual(len(templates), 6)
        original = templates[0]
        with db.connect() as connection:
            connection.execute("DELETE FROM templates WHERE id=?", (original["id"],))
            connection.execute("INSERT INTO templates VALUES(?,?,?,?,?,?,?,?,1,?,?)",
                (original["id"], original["name"], original["subject"], original["question_bank_id"], original["duration_minutes"], original["total_score"], json.dumps(original["sections"]), json.dumps(original["distribution_rules"]), original["created_at"], original["updated_at"]))
            self.assertEqual(repair_legacy_presets(connection), [original["id"]])
            restored = db.row_to_template(connection.execute("SELECT * FROM templates WHERE id=?", (original["id"],)).fetchone())
            self.assertEqual(restored, original)
            self.assertEqual(repair_legacy_presets(connection), [])
        self.assertEqual(len(install_408()), 6)

    def test_408_create_catalog_restart_preserves_tags(self):
        payload = QuestionCreate(subject="计算机408", question_bank_id="bank-computer-408", type="choice", stem_markdown="队列测试", options=[{"key": "A", "text": "先进先出"}], answer_markdown="A", chapter="队列", tags=["数据结构", "队列"])
        with patch("app.main.write_question_json"):
            question = create_question(payload)
        self.assertEqual(question["tags"], ["数据结构", "队列"])
        with db.connect() as connection, patch.object(db, "write_question_json"):
            db.normalize_stored_tags(connection)
            tags = json.loads(connection.execute("SELECT tags_json FROM questions WHERE id=?", (question["id"],)).fetchone()[0])
        self.assertEqual(tags, question["tags"])
        self.assertIn("数据结构", [tag["name"] for tag in list_tags("bank-computer-408")])
