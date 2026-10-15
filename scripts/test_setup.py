"""Windows installer regressions using local fake npm; no network or user data."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
PS=Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'

class SetupTests(unittest.TestCase):
    def test_install_failure_path_spaces_retry_idempotence_and_repair(self):
        with tempfile.TemporaryDirectory(prefix='paper setup ') as directory:
            base=Path(directory)
            project=base/'项目 space (copy) & [test] !'
            (project/'scripts').mkdir(parents=True)
            (project/'frontend').mkdir()
            (project/'backend').mkdir()
            for name in ('environment-common.ps1','setup-environment.ps1','verify-frontend.cjs'):
                shutil.copy2(ROOT/'scripts'/name,project/'scripts'/name)
            shutil.copy2(ROOT/'setup.bat',project/'setup.bat')
            shutil.copy2(ROOT/'start.bat',project/'start.bat')
            (project/'scripts/start-backend.ps1').write_text("[IO.File]::WriteAllText((Join-Path $PSScriptRoot '../started.txt'),'started')\nexit 0\n")
            (project/'backend/requirements.txt').write_text('# fixture\n')
            (project/'scripts/verify-backend.py').write_text("print('Fixture backend check passed')\n")
            package={'name':'fixture','version':'1.0.0','dependencies':{'fixture':'1.0.0'}}
            lock={'lockfileVersion':3,'packages':{'':package,'node_modules/fixture':{'version':'1.0.0'}}}
            (project/'frontend/package.json').write_text(json.dumps(package))
            (project/'frontend/package-lock.json').write_text(json.dumps(lock))
            helper=base/'fake_npm.py'
            helper.write_text(r'''import json,os,sys
from pathlib import Path
root=Path(os.environ['SETUP_FIXTURE'])
args=sys.argv[1:]
with (root/'calls.jsonl').open('a') as f:f.write(json.dumps({'cwd':str(Path.cwd()),'args':args})+'\n')
if args[0]=='ci':
    if os.getenv('SETUP_FAIL')=='1':raise SystemExit(17)
    assert Path.cwd()==root/'frontend'
    assert args[args.index('--prefix')+1]==str(root/'frontend')
    assert '--include=dev' in args and '--ignore-scripts=false' in args
    modules=root/'frontend/node_modules'
    for name in ('fixture','.bin','electron/dist'):(modules/name).mkdir(parents=True,exist_ok=True)
    (modules/'fixture/package.json').write_text('{"version":"1.0.0"}')
    (modules/'.bin/electron-vite.cmd').write_text('@exit /b 0')
    (modules/'.bin/tsc.cmd').write_text('@exit /b 0')
    (modules/'electron/path.txt').write_text('electron.exe')
    (modules/'electron/dist/electron.exe').write_bytes(b'x'*2048)
''',encoding='utf-8')
            npm=base/'fake npm.cmd'
            npm.write_text('@echo off\r\n"'+sys.executable+'" "'+str(helper)+'" %*\r\nexit /b %errorlevel%\r\n',encoding='ascii')
            def quote(value):return str(value).replace("'","''")
            common=project/'scripts/environment-common.ps1'
            common.write_text(common.read_text()+"\nfunction Find-ProjectNode { return @{Node='"+quote(shutil.which('node'))+"';Npm='"+quote(npm)+"'} }\nfunction Find-ProjectPython { return '"+quote(sys.executable)+"' }\n",encoding='utf-8-sig')
            env={**os.environ,'SETUP_FIXTURE':str(project),'PAPER_HELPER_NO_PAUSE':'1','SETUP_FAIL':'1'}
            def run(filename):
                command='"'+str(Path(os.environ['SystemRoot'])/'System32/cmd.exe')+'" /d /s /c ""'+str(project/filename)+'""'
                result=subprocess.run(command,cwd=base,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=120)
                return result
            failed=run('start.bat')
            self.assertEqual(failed.returncode,1,failed.stdout+failed.stderr)
            self.assertIn('exit 17',failed.stdout+failed.stderr)
            self.assertFalse((project/'started.txt').exists())
            self.assertFalse((project/'frontend/node_modules/.paper-helper-lock').exists())
            env.pop('SETUP_FAIL')
            fixed=run('setup.bat')
            self.assertEqual(fixed.returncode,0,fixed.stdout+fixed.stderr)
            calls=lambda:[json.loads(s) for s in (project/'calls.jsonl').read_text().splitlines()]
            count=sum(c['args'][0]=='ci' for c in calls())
            again=run('setup.bat')
            self.assertEqual(again.returncode,0,again.stdout+again.stderr)
            self.assertEqual(sum(c['args'][0]=='ci' for c in calls()),count)
            package['scripts']={'smoke:boot':'electron boot-screen-smoke.cjs --no-sandbox'}
            (project/'frontend/package.json').write_text(json.dumps(package))
            scripts_only=run('start.bat')
            self.assertEqual(scripts_only.returncode,0,scripts_only.stdout+scripts_only.stderr)
            self.assertEqual(sum(c['args'][0]=='ci' for c in calls()),count)
            (project/'frontend/node_modules/.bin/electron-vite.cmd').unlink()
            repaired=run('start.bat')
            self.assertEqual(repaired.returncode,0,repaired.stdout+repaired.stderr)
            self.assertTrue((project/'started.txt').exists())
            self.assertEqual(sum(c['args'][0]=='ci' for c in calls()),count+1)
            (project/'frontend/package-lock.json').write_text(json.dumps(lock,indent=2))
            refreshed=run('setup.bat')
            self.assertEqual(refreshed.returncode,0,refreshed.stdout+refreshed.stderr)
            self.assertEqual(sum(c['args'][0]=='ci' for c in calls()),count+2)
            self.assertFalse((project/'package.json').exists())
            self.assertTrue(any(c['args']==['run','build'] for c in calls()))
            (project/'.venv/pyvenv.cfg').write_text('home = Z:\\missing-python\nversion = 3.11.9\n')
            restored=run('setup.bat')
            self.assertEqual(restored.returncode,0,restored.stdout+restored.stderr)
            self.assertEqual(len(list(project.glob('.venv.broken-*'))),1)
            self.assertTrue((project/'.venv/Scripts/python.exe').is_file())

    def test_incomplete_project_stops_before_installing(self):
        with tempfile.TemporaryDirectory() as directory:
            result=subprocess.run([str(PS),'-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'scripts/setup-environment.ps1'),'-ProjectRoot',directory,'-CheckOnly'],capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode,1)
            self.assertIn('Incomplete project',result.stdout+result.stderr)

    def test_occupied_backend_port_is_rejected_without_creating_database(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket() as listener:
            listener.bind(('127.0.0.1',0));listener.listen()
            database=Path(directory)/'untouched.sqlite3'
            env={**os.environ,'PAPER_HELPER_API_PORT':str(listener.getsockname()[1]),'PAPER_HELPER_DB_PATH':str(database)}
            result=subprocess.run([str(PS),'-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'scripts/start-backend.ps1'),'-HealthCheckOnly'],env=env,capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode,1,result.stdout+result.stderr)
            self.assertIn('already in use',result.stdout+result.stderr)
            self.assertFalse(database.exists())

if __name__=='__main__':unittest.main(verbosity=2)
