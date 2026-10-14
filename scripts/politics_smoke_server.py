"""Serve the real app with a project-local temporary database and politics bundle."""
from pathlib import Path
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
out = root / "frontend/out/politics-smoke"
out.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(out)
sys.path[:0] = [str(root / "backend"), str(root / "backend/tests")]
from test_learning_agent import LearningAgentTests
from app import db
from app.github_bundle import load_batch, politics_solutions
from app.main import app
import uvicorn

fixture = LearningAgentTests()
fixture.setUp()
try:
    with db.connect() as c:
        c.execute("CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        load_batch(c, politics_solutions(), "github_politics_solutions_v1_initialized")
    uvicorn.run(app, host="127.0.0.1", port=8017, lifespan="off", log_level="warning")
finally:
    fixture.doCleanups()
