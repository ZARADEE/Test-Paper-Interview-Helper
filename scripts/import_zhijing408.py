"""Extract the authorized v1.1 release without executing its JavaScript."""
import base64
import hashlib
import io
import json
import sys
from collections import Counter
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.db import utc_now


def extract(path):
    raw = Path(path).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != '56b5547d5d0dddec65bfc05cc5ec551f68876af4f756054014e66420acb9c114':
        raise ValueError('Unexpected release checksum; no data imported')
    payload, _ = json.JSONDecoder().raw_decode(raw.decode('utf-8').split('window.__ZHJ_OFFLINE__=', 1)[1])
    paper = payload['paperHtml']
    questions, _ = json.JSONDecoder().raw_decode(paper.split('"questions":', 1)[1])
    if len(questions) != 1576 or len({q['id'] for q in questions}) != 1576:
        raise ValueError('Incomplete or duplicate question IDs')
    destination = ROOT / 'backend/data/bundled/zhijing408'
    destination.mkdir(parents=True, exist_ok=True)
    entries, now, images = [], utc_now(), 0
    for q in questions:
        qid = 'zhijing408-' + q['id']
        if not q['options'] or not q['answer'] or any(key not in 'ABCD' for key in q['answer']):
            raise ValueError('Invalid options/answer: ' + qid)
        entry = dict(id=qid, type='choice', subject='计算机408', question_bank_id='bank-computer-408',
                     stem_markdown=q['stem'], options=q['options'], answer_markdown=q['answer'],
                     analysis_markdown=q['explanation'], tags=[q['subject'], q['chapter']],
                     chapter=q['chapter'], knowledge_points=[q['chapter']], difficulty='medium', score=2,
                     review_status='approved', created_at=now, updated_at=now, previews={})
        for field, kind in [('questionImages','question'),('explanationImages','analysis')]:
            frames=[]
            for data in q.get(field, []):
                if not data.startswith('data:image/') or ';base64,' not in data:
                    raise ValueError('Image not embedded: ' + qid)
                with Image.open(io.BytesIO(base64.b64decode(data.split(',',1)[1], validate=True))) as image:
                    frames.append(image.convert('RGB'))
            if not frames:
                continue
            canvas=Image.new('RGB',(max(f.width for f in frames),sum(f.height for f in frames)+12*(len(frames)-1)), 'white')
            offset=0
            for frame in frames:
                canvas.paste(frame,(0,offset)); offset+=frame.height+12
            name=f'{qid}-{kind}.webp'; canvas.save(destination/name, 'WEBP', lossless=True)
            entry['previews'][kind]={'file':name,'sha256':hashlib.sha256((destination/name).read_bytes()).hexdigest()}
            if kind == 'question':
                entry['source_document_id']='source-zhijing408'; entry['source_page']=q.get('questionPdfPage') or 1
            else:
                entry['analysis_source_document_id']='source-zhijing408'
            images+=1
        entries.append(entry)
    manifest={'source':'智镜 408 离线版 v1.1 / 27 relax 408 1000题', 'release_sha256':digest,
              'authorization':'User confirmed permission for integration on 2026-10-09', 'generated_at':now,
              'counts':dict(Counter(q['tags'][0] for q in entries)), 'image_count':images,'questions':entries}
    (destination/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'questions':len(entries),'images':images,'by_subject':manifest['counts']},ensure_ascii=False))


if __name__ == '__main__':
    extract(sys.argv[1])
