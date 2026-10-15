"""Capture public GitHub competitor evidence without touching application data."""
from __future__ import annotations

import concurrent.futures
import base64
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess
import sys

SUPPLEMENTS = [
    ('HKUDS/DeepTutor', 'deeptutor/capabilities/mastery/tools.py'),
    ('THU-MAIC/OpenMAIC', 'app/api/quiz-grade/route.ts'),
    ('oppia/oppia', 'core/domain/skill_domain.py'),
    ('moodle/moodle', 'public/mod/quiz/classes/quiz_attempt.php'),
    ('CaviraOSS/PageLM', 'LICENSE.md'),
    ('HabitRPG/habitica', 'LICENSE'),
    ('learningequality/kolibri', 'kolibri/core/exams/models.py'),
    ('learnhouse/learnhouse', 'apps/api/src/services/courses/activities/assignments.py'),
]

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/research/github-competitors-2026-10-15'
REPOS = [
    'HKUDS/DeepTutor', 'THU-MAIC/OpenMAIC', 'CaviraOSS/PageLM',
    'learnhouse/learnhouse', 'oppia/oppia', 'learningequality/kolibri',
    'algorithm-visualizer/algorithm-visualizer', 'HabitRPG/habitica',
    'Mintplex-Labs/anything-llm', 'moodle/moodle',
]

def fetch(url: str) -> bytes:
    result = subprocess.run(
        ['curl.exe', '-L', '--fail', '--silent', '--show-error',
         '--max-time', '40', '-H', 'Accept: application/vnd.github+json', url],
        capture_output=True, check=True,
    )
    return result.stdout

def capture(repo: str) -> dict:
    observed = dt.datetime.now(dt.timezone.utc).isoformat()
    record = {'requested_repo': repo, 'observed_at_utc': observed, 'errors': []}
    folder = OUT / repo.replace('/', '__')
    folder.mkdir(parents=True, exist_ok=True)
    try:
        cached = folder / 'repository.json'
        metadata = json.loads(cached.read_text(encoding='utf-8')) if cached.exists() else json.loads(fetch('https://api.github.com/repos/' + repo))
        if not cached.exists():
            cached.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        record['metadata_collected_at_utc'] = dt.datetime.fromtimestamp(cached.stat().st_mtime, dt.timezone.utc).isoformat()
        for key in ('full_name', 'html_url', 'description', 'stargazers_count', 'forks_count', 'open_issues_count', 'default_branch', 'created_at', 'updated_at', 'pushed_at', 'archived', 'license'):
            record[key] = metadata.get(key)
        canonical = metadata['full_name']
        branch = metadata['default_branch']
        try:
            commit = json.loads(fetch(f'https://api.github.com/repos/{canonical}/commits/{branch}'))
            record['commit_sha'] = commit['sha']
            record['commit_date'] = commit['commit']['committer']['date']
            record['tree_sha'] = commit['commit']['tree']['sha']
        except Exception as error:
            record['errors'].append('commit: ' + str(error))
        ref = record.get('commit_sha', branch)
        record['version_pinned'] = 'commit_sha' in record
        (folder / 'evidence.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        try:
            readme = json.loads(fetch(f'https://api.github.com/repos/{canonical}/readme?ref={ref}'))
            content = base64.b64decode(readme['content'])
            (folder / 'README.source.md').write_bytes(content)
            record['readme_path'] = readme['path']
            record['readme_source_url'] = readme['html_url']
            record['readme_sha256'] = hashlib.sha256(content).hexdigest()
            (folder / 'evidence.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            return record
        except Exception as error:
            record['errors'].append('README API: ' + str(error))
        for name in ('README.md', 'README.rst', 'README'):
            try:
                url = f'https://raw.githubusercontent.com/{canonical}/{ref}/{name}'
                content = fetch(url)
                (folder / name).write_bytes(content)
                record['readme_path'] = name
                record['readme_source_url'] = url
                record['readme_sha256'] = hashlib.sha256(content).hexdigest()
                break
            except Exception as error:
                if name == 'README':
                    record['errors'].append('README: ' + str(error))
    except Exception as error:
        record['errors'].append(str(error))
    (folder / 'evidence.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return record

def main() -> None:
    target = OUT.parent / 'github-competitor-snapshot-2026-10-15.json'
    if target.exists():
        print('Historical snapshot already exists; leaving it unchanged. Use its pinned URLs for verification, or --supplements to restore missing source evidence.')
        return
    OUT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(capture, REPOS))
    snapshot = {
        'research_date': '2026-10-15',
        'collected_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
        'selection': 'Ten newly selected product/capability benchmarks; stars >= 1000 at collection; not an exhaustive GitHub ranking.',
        'method': 'Public GitHub REST repository/commit metadata and commit-pinned official README; no competitor runtime or learning outcome test.',
        'repositories': records,
    }
    target.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for record in records:
        print(json.dumps({key: record.get(key) for key in ('full_name', 'stargazers_count', 'pushed_at', 'commit_sha', 'readme_path', 'errors')}, ensure_ascii=False))

def supplements() -> None:
    snapshot = json.loads((OUT.parent / 'github-competitor-snapshot-2026-10-15.json').read_text(encoding='utf-8'))
    refs = {r['full_name']: r['commit_sha'] for r in snapshot['repositories']}
    def get_source(item):
        repo, path = item
        ref = refs[repo]
        result = {'repo': repo, 'path': path, 'commit_sha': ref, 'url': f'https://github.com/{repo}/blob/{ref}/{path}'}
        file = OUT / repo.replace('/', '__') / ('source__' + path.replace('/', '__'))
        try:
            if file.exists():
                raw = file.read_bytes()
            else:
                try:
                    data = json.loads(fetch(f'https://api.github.com/repos/{repo}/contents/{path}?ref={ref}'))
                    raw = base64.b64decode(data['content'])
                except Exception:
                    raw = fetch(f'https://raw.githubusercontent.com/{repo}/{ref}/{path}')
                file.write_bytes(raw)
            result['sha256'] = hashlib.sha256(raw).hexdigest()
            result['saved_file'] = str(file.relative_to(ROOT)).replace('\\', '/')
            result['bytes'] = len(raw)
        except Exception as error:
            result['error'] = str(error)
        return result
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(get_source, SUPPLEMENTS))
    (OUT.parent / 'github-competitor-code-evidence-2026-10-15.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for result in results:
        print(json.dumps(result, ensure_ascii=False))

def finalize() -> None:
    snapshot_path = OUT.parent / 'github-competitor-snapshot-2026-10-15.json'
    snapshot = json.loads(snapshot_path.read_text(encoding='utf-8'))
    for record in snapshot['repositories']:
        folder = OUT / record['full_name'].replace('/', '__')
        metadata_file = folder / 'repository.json'
        record['metadata_collected_at_utc'] = None
        record['metadata_cache_written_at_utc'] = dt.datetime.fromtimestamp(metadata_file.stat().st_mtime, dt.timezone.utc).isoformat()
        record['metadata_collection_note'] = 'Repository metadata was fetched earlier in this research session and reused. The first fetch timestamp was not retained. cache_written_at is the subsequent local file write time, not the first API fetch time; observed_at_utc is evidence assembly time.'
        (folder / 'evidence.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    snapshot['local_baseline_commit'] = '048dbe6d377e01890e0bd997dfa8611e3e135e30'
    snapshot['upstream_cache_policy'] = 'Full upstream documents and source files are local research cache excluded from Git. Public metadata, URLs, commit IDs and checksums are retained in the research indexes.'
    snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    supplements()

if __name__ == '__main__':
    if '--finalize' in sys.argv:
        finalize()
    elif '--supplements' in sys.argv:
        supplements()
    else:
        main()
