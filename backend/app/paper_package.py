"""Paired paper/answer exports; both files consume one immutable snapshot."""
from __future__ import annotations
import base64
import copy
import hashlib
import io
import json
import re
import threading
import uuid
import zipfile
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from . import db, exporters
from .composer import load_paper

router = APIRouter(prefix='/api/papers', tags=['paper-package'])
_build_lock = threading.Lock()

def init_tables(connection):
    connection.executescript('''
        CREATE TABLE IF NOT EXISTS paper_blueprints (
            paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
            template_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS paper_export_versions (
            id TEXT PRIMARY KEY,
            paper_id TEXT NOT NULL REFERENCES papers(id),
            format TEXT NOT NULL, digest TEXT NOT NULL,
            snapshot_json TEXT NOT NULL, issues_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(paper_id, format, digest)
        );
    ''')

class Prepare(BaseModel):
    format: Literal['pdf', 'docx'] = 'pdf'
    source_version: str | None = Field(default=None, max_length=100)

class Build(BaseModel):
    allow_missing: bool = False

def public_snapshot(paper):
    result = copy.deepcopy(paper)
    for q in result['questions']:
        q['frozen_question_preview'] = bool(q.get('_frozen_previews',{}).get('question'))
        q.pop('_frozen_previews', None)
    return result

def freeze(paper):
    paper = copy.deepcopy(paper)
    questions = paper.get('questions', [])
    if not questions or len({q['id'] for q in questions}) != len(questions):
        raise HTTPException(422, '试卷为空或题目重复，请重新检查组卷。')
    expected = paper.get('question_ids', [q['id'] for q in questions])
    if set(expected) != {q['id'] for q in questions} or len(expected) != len(questions):
        raise HTTPException(422, '试卷题目缺失，不能生成貌似完整的整套文件。')
    if not paper.get('validation', {}).get('valid'):
        raise HTTPException(422, '试卷尚有组卷缺口，请修正后再导出整套。')
    if not paper.get('template'):
        raise HTTPException(422, '试卷模板信息缺失。')
    issues = []
    for number, q in enumerate(questions, 1):
        previews = {}
        for kind in ('question', 'analysis'):
            image = exporters.source_preview(q, kind)
            if image:
                try:
                    from PIL import Image
                    with Image.open(io.BytesIO(image)) as decoded:
                        decoded.verify()
                except Exception as exc:
                    raise HTTPException(422, f'第 {number} 题的图片损坏，请检查后再导出。') from exc
            previews[kind] = base64.b64encode(image).decode('ascii') if image else None
        q['_frozen_previews'] = previews
        missing = []
        if not previews['question'] and not q.get('stem_markdown', '').strip():
            raise HTTPException(422, f'第 {number} 题缺少可用题面。')
        if q.get('source_document_id') and (q.get('source_regions') or q.get('source_page')) and not previews['question']:
            missing.append('原版题面图片不可用，使用文字题面')
        if not previews['analysis']:
            if not q.get('answer_markdown', '').strip(): missing.append('参考答案缺失')
            if not q.get('analysis_markdown', '').strip(): missing.append('文字解析缺失')
            if q.get('analysis_source_document_id') and q.get('analysis_regions'):
                missing.append('原版解析图片不可用')
        if missing: issues.append({'number':number, 'question_id':q['id'], 'messages':missing})
    return paper, issues

def version_row(paper_id, version):
    with db.connect() as c:
        row = c.execute('SELECT * FROM paper_export_versions WHERE id=? AND paper_id=?', (version,paper_id)).fetchone()
    if not row: raise HTTPException(404, '该试卷导出版本不存在。')
    return row

@router.post('/{paper_id}/package/prepare')
def prepare(paper_id: str, payload: Prepare):
    if payload.source_version:
        paper = json.loads(version_row(paper_id,payload.source_version)['snapshot_json'])
    else:
        with db.connect() as c:
            paper = load_paper(c, paper_id)
    if not paper: raise HTTPException(404, '试卷不存在。')
    frozen, issues = freeze(paper)
    canonical = json.dumps(frozen, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    digest = hashlib.sha256(canonical.encode()).hexdigest()
    version = 'pack-' + uuid.uuid4().hex[:20]
    with db.connect() as c:
        c.execute('INSERT OR IGNORE INTO paper_export_versions VALUES(?,?,?,?,?,?,?)',
                  (version,paper_id,payload.format,digest,canonical,json.dumps(issues,ensure_ascii=False),db.utc_now()))
        row = c.execute('SELECT * FROM paper_export_versions WHERE paper_id=? AND format=? AND digest=?', (paper_id,payload.format,digest)).fetchone()
    return {'version':row['id'],'format':row['format'],'issues':json.loads(row['issues_json']),
            'title':frozen['title'],'duration_minutes':frozen['template']['duration_minutes']}

@router.get('/{paper_id}/package/{version}')
def get_version(paper_id: str, version: str):
    row = version_row(paper_id,version)
    paper = public_snapshot(json.loads(row['snapshot_json']))
    paper['export_version'] = version
    return paper

def validate_file(path: Path, format: str):
    if format == 'docx':
        with zipfile.ZipFile(path) as z:
            if z.testzip() or 'word/document.xml' not in z.namelist(): raise RuntimeError('Word 文件校验失败。')
    else:
        import fitz
        with fitz.open(path) as pdf:
            if not pdf.page_count: raise RuntimeError('PDF 没有可用页面。')

@router.get('/{paper_id}/package/{version}/preview/{question_id}')
def preview(paper_id: str, version: str, question_id: str):
    paper = json.loads(version_row(paper_id,version)['snapshot_json'])
    q = next((q for q in paper['questions'] if q['id']==question_id), None)
    content = q and q.get('_frozen_previews',{}).get('question')
    if not content: raise HTTPException(404, '该版本没有原版题面图片。')
    return Response(base64.b64decode(content), media_type='image/png')

@router.post('/{paper_id}/package/{version}/build')
def build(paper_id: str, version: str, payload: Build):
    row = version_row(paper_id,version)
    issues = json.loads(row['issues_json'])
    if issues and not payload.allow_missing:
        raise HTTPException(409, '存在答案或素材缺失，请先检查清单，再选择是否带标注导出。')
    with _build_lock:
        with db.connect() as c:
            existing = c.execute('SELECT * FROM export_jobs WHERE id=?', (version,)).fetchone()
        if existing and existing['status']=='completed' and Path(existing['output_path']).is_file():
            return {'id':version,'version':version,'status':'completed'}
        folder = db.EXPORT_ROOT / version
        paper = json.loads(row['snapshot_json'])
        paper['_export_version'] = version
        paper['_export_issues'] = issues
        title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', paper['title']).strip(' .')[:70] or '试卷'
        target = folder / (title + '_题卷与答案册.zip')
        temporary = folder / 'package.tmp'
        try:
            folder.mkdir(parents=True,exist_ok=True)
            paths = []
            for variant, label in [('question','题卷'),('answer','答案册')]:
                path = folder / (title+'_'+label+'.'+row['format'])
                (exporters.export_pdf if row['format']=='pdf' else exporters.export_docx)(paper,variant,path)
                validate_file(path,row['format'])
                paths.append(path)
            with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED) as archive:
                for path in paths: archive.write(path, path.name)
            with zipfile.ZipFile(temporary) as archive:
                if len(archive.namelist())!=2 or archive.testzip(): raise RuntimeError('成套文件校验失败。')
            temporary.replace(target)
            with db.connect() as c:
                c.execute("INSERT OR REPLACE INTO export_jobs(id,paper_id,format,variant,status,output_path,created_at) VALUES(?,?,'zip','package','completed',?,?)", (version,paper_id,str(target),db.utc_now()))
            return {'id':version,'version':version,'status':'completed'}
        except Exception as exc:
            with db.connect() as c:
                c.execute("INSERT OR REPLACE INTO export_jobs(id,paper_id,format,variant,status,error,created_at) VALUES(?,?,'zip','package','failed',?,?)", (version,paper_id,str(exc),db.utc_now()))
            raise HTTPException(500, '整套导出未完成，可按同一版本重试：'+str(exc)) from exc
