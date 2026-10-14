import base64
import io
import json
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
import test_learning_agent as fixtures
from app import db, paper_package as package
from app.composer import compose_paper, load_paper
from app.main import app

class PaperPackageTests(unittest.TestCase):
    setUp = fixtures.LearningAgentTests.setUp

    def make_paper(self):
        with db.connect() as c:
            return compose_paper(c,self.template,7,'计时训练样卷')

    def content(self, version):
        with db.connect() as c:
            row=c.execute('SELECT * FROM export_jobs WHERE id=?',(version,)).fetchone()
        with zipfile.ZipFile(row['output_path']) as archive:
            self.assertEqual(len(archive.namelist()),2)
            return {name:archive.read(name) for name in archive.namelist()}

    def test_word_pair_is_frozen_and_retry_returns_identical_files(self):
        paper=self.make_paper(); prepared=package.prepare(paper['id'],package.Prepare(format='docx'))
        self.assertEqual(prepared['issues'],[])
        self.assertEqual(package.prepare(paper['id'],package.Prepare(format='docx'))['version'],prepared['version'])
        with db.connect() as c:
            c.execute("UPDATE questions SET answer_markdown='CHANGED',stem_markdown='NEW STEM' WHERE id=?",(paper['questions'][0]['id'],))
            c.execute('UPDATE templates SET duration_minutes=7 WHERE id=?',(self.template['id'],))
        job=package.build(paper['id'],prepared['version'],package.Build());parts=self.content(job['id'])
        for name,content in parts.items():
            with zipfile.ZipFile(io.BytesIO(content)) as doc:
                xml=doc.read('word/document.xml').decode()
            self.assertIn(prepared['version'],xml);self.assertNotIn('CHANGED',xml);self.assertNotIn('NEW STEM',xml)
            self.assertEqual('答案：' in xml,'答案册' in name)
        self.assertEqual(package.build(paper['id'],prepared['version'],package.Build()),job)
        self.assertEqual(parts,self.content(job['id']))
        self.assertNotEqual(package.prepare(paper['id'],package.Prepare(format='docx'))['version'],prepared['version'])
        self.assertEqual(package.get_version(paper['id'],prepared['version'])['template']['duration_minutes'],self.template['duration_minutes'])

    def test_pdf_pair_download_has_two_readable_matching_documents(self):
        import fitz
        paper=self.make_paper();client=TestClient(app)
        response=client.post('/api/papers/'+paper['id']+'/package/prepare',json={'format':'pdf'});self.assertEqual(response.status_code,200)
        version=response.json()['version']
        response=client.post('/api/papers/'+paper['id']+'/package/'+version+'/build',json={});self.assertEqual(response.status_code,200)
        download=client.get('/api/exports/'+version+'/download');self.assertEqual(download.status_code,200)
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            for name in archive.namelist():
                with fitz.open(stream=archive.read(name),filetype='pdf') as document:
                    self.assertGreater(document.page_count,0)
                    text=''.join(page.get_text() for page in document)
                    self.assertIn(version,text);self.assertIn(paper['id'],text)

    def test_missing_answer_requires_confirmation_and_annotations(self):
        paper=self.make_paper()
        with db.connect() as c:c.execute("UPDATE questions SET answer_markdown='',analysis_markdown='' WHERE id=?",(paper['questions'][0]['id'],))
        prepared=package.prepare(paper['id'],package.Prepare(format='docx'));self.assertEqual(len(prepared['issues']),1)
        with self.assertRaises(HTTPException) as failure:package.build(paper['id'],prepared['version'],package.Build())
        self.assertEqual(failure.exception.status_code,409)
        package.build(paper['id'],prepared['version'],package.Build(allow_missing=True))
        answer=next(v for k,v in self.content(prepared['version']).items() if '答案册' in k)
        with zipfile.ZipFile(io.BytesIO(answer)) as doc:self.assertIn('参考答案缺失',doc.read('word/document.xml').decode())

    def test_image_only_answer_is_valid_and_assets_remain_frozen(self):
        from PIL import Image
        buffer=io.BytesIO();Image.new('RGB',(20,20),'white').save(buffer,format='PNG');image=buffer.getvalue()
        paper=self.make_paper()
        with db.connect() as c:c.execute("UPDATE questions SET answer_markdown='',analysis_markdown='',scoring_points_json=? WHERE id=?",(json.dumps([{'label':'独立评分点','score':2}],ensure_ascii=False),paper['questions'][0]['id']))
        with patch('app.exporters.source_preview',return_value=image):prepared=package.prepare(paper['id'],package.Prepare(format='docx'))
        self.assertEqual(prepared['issues'],[])
        with patch('app.exporters.bundled_preview',side_effect=AssertionError('must not reload live images')):
            package.build(paper['id'],prepared['version'],package.Build())
        self.assertEqual(package.preview(paper['id'],prepared['version'],paper['questions'][0]['id']).body,image)
        answer=next(v for k,v in self.content(prepared['version']).items() if '答案册' in k)
        with zipfile.ZipFile(io.BytesIO(answer)) as doc:self.assertIn('独立评分点',doc.read('word/document.xml').decode())

    def test_partial_failure_is_not_downloadable_and_retry_preserves_version(self):
        paper=self.make_paper();prepared=package.prepare(paper['id'],package.Prepare(format='docx'))
        real=package.exporters.export_docx
        def fail_answer(paper,variant,target):
            if variant=='answer':raise RuntimeError('simulated answer write failure')
            return real(paper,variant,target)
        with patch('app.exporters.export_docx',side_effect=fail_answer),self.assertRaises(HTTPException):package.build(paper['id'],prepared['version'],package.Build())
        self.assertEqual(TestClient(app).get('/api/exports/'+prepared['version']+'/download').status_code,404)
        self.assertEqual(package.build(paper['id'],prepared['version'],package.Build())['version'],prepared['version'])

    def test_missing_question_or_corrupt_image_cannot_produce_complete_package(self):
        paper=self.make_paper()
        with patch('app.exporters.source_preview',return_value=b'broken'),self.assertRaises(HTTPException):package.prepare(paper['id'],package.Prepare())
        with db.connect() as c:c.execute('DELETE FROM paper_questions WHERE paper_id=? AND question_id=?',(paper['id'],paper['questions'][0]['id']))
        with self.assertRaises(HTTPException):package.prepare(paper['id'],package.Prepare())

    def test_wrong_paper_cannot_access_another_snapshot(self):
        first=self.make_paper();second=self.make_paper();prepared=package.prepare(first['id'],package.Prepare())
        with self.assertRaises(HTTPException) as failure:package.get_version(second['id'],prepared['version'])
        self.assertEqual(failure.exception.status_code,404)

    def test_reexport_existing_version_never_silently_switches_to_live_questions(self):
        paper=self.make_paper();first=package.prepare(paper['id'],package.Prepare(format='docx'))
        with db.connect() as c:c.execute("UPDATE questions SET stem_markdown='EDITED LATER' WHERE id=?",(paper['questions'][0]['id'],))
        same=package.prepare(paper['id'],package.Prepare(format='docx',source_version=first['version']))
        self.assertEqual(same['version'],first['version'])
        pdf=package.prepare(paper['id'],package.Prepare(format='pdf',source_version=first['version']))
        self.assertEqual(package.get_version(paper['id'],pdf['version'])['questions'][0]['stem_markdown'],'测试题')
