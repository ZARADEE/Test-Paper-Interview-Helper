"""Serve the real API against an isolated fixture for desktop acceptance."""
from pathlib import Path
import json
import sys
import tempfile

root=Path(__file__).resolve().parents[1]
out=root/'frontend/out/timer-smoke'
out.mkdir(parents=True,exist_ok=True)
tempfile.tempdir=str(out)
sys.path[:0]=[str(root/'backend'),str(root/'backend/tests')]
from test_learning_agent import LearningAgentTests
from app.composer import compose_paper
from app import db
from app.main import app
import uvicorn

fixture=LearningAgentTests()
fixture.setUp()
try:
    with db.connect() as c:
        paper=compose_paper(c,fixture.template,7,'番茄钟联动验收卷')
    (out/'fixture.json').write_text(json.dumps({'paper_id':paper['id'],'duration_minutes':paper['template']['duration_minutes']}),encoding='utf8')
    uvicorn.run(app,host='127.0.0.1',port=8017,lifespan='off',log_level='warning')
finally:
    fixture.doCleanups()
