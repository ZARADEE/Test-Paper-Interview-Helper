import hashlib
import json
import sqlite3
import sys
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"backend"))
from app import db
root=ROOT/"backend/data/bundled/github"
p=root/"mocks408.json"
m=json.loads(p.read_text(encoding="utf-8"))
for q in m["questions"]:
    for kind in ("question","analysis"):
        src=root/(q["id"]+"-"+kind+".png")
        target=src.with_suffix(".webp")
        with Image.open(src) as im:
            im.convert("RGB").save(target,"WEBP",lossless=True,method=0)
        q["previews"][kind]={"file":target.name,"sha256":hashlib.sha256(target.read_bytes()).hexdigest()}
m["ready"]=True
p.write_text(json.dumps(m,ensure_ascii=False,indent=2),encoding="utf-8")
backup=db.DB_PATH.with_name("paper_helper.before-408-mocks.sqlite3")
if not backup.exists():
    with sqlite3.connect(db.DB_PATH) as a,sqlite3.connect(backup) as b:a.backup(b)
db.init_db()
with db.connect() as c:
    print([tuple(r) for r in c.execute("SELECT type,COUNT(*) FROM questions WHERE question_bank_id='bank-computer-408' GROUP BY type")])
