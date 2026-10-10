"""Isolated E2E server: synthetic grader, no real credentials or user database."""
from pathlib import Path
import json
import sys
import tempfile
import uvicorn
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"backend"))
from app import db
root=Path(tempfile.mkdtemp(prefix="paper-study-smoke-"))
db.DB_PATH=root/"test.sqlite3"
db.DATA_ROOT=root
db.DOCUMENT_ROOT=root/"documents"
db.QUESTION_ROOT=root/"questions"
db.EXPORT_ROOT=root/"exports"
from app.main import app
from app import grading
calls=[]
def fake_completion(settings,payload,*,system_prompt=None):
    assert system_prompt==grading.GRADING_SYSTEM_PROMPT
    assert settings.api_key.get_secret_value()=="smoke-only-not-a-real-key"
    calls.append({"prompt_version":grading.PROMPT_VERSION,"answer":payload["student_answer"]})
    return {"verdict":"partial","confidence":"medium","score":None,"feedback":"端到端测试的模拟反馈：请补充边界条件。","strengths":["已写出基本思路"],"omissions":["尚未覆盖边界条件"],"next_steps":["补充边界情况后重新练习"],"points":[]}
grading.completion=fake_completion
@app.get("/__test/grader-calls")
def count_calls():return {"calls":len(calls),"items":calls}
if __name__=="__main__":
    print("Isolated smoke database:",db.DB_PATH,flush=True)
    uvicorn.run(app,host="127.0.0.1",port=8017,log_level="warning")
