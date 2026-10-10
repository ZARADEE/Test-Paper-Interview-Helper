"""Read-only dependency check; never imports app.main or initializes a database."""
import importlib
import importlib.metadata
import re
import sys
from pathlib import Path

def main():
    if sys.version_info < (3, 11) or sys.maxsize <= 2**32:
        raise RuntimeError('Python 3.11+ (64-bit) is required.')
    root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
    for line in (root/'backend/requirements.txt').read_text(encoding='utf-8').splitlines():
        line=line.strip()
        if not line or line.startswith('#'):
            continue
        match=re.fullmatch(r'([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?==([^ ;]+)',line)
        if not match:
            raise RuntimeError('Unrecognized dependency pin: '+line)
        name,expected=match.groups()
        actual=importlib.metadata.version(name)
        if actual!=expected:
            raise RuntimeError(f'{name}: expected {expected}, found {actual}')
    for name in ('fastapi','uvicorn','fitz','docx','reportlab','PIL.Image','python_multipart','fsrs','tzdata'):
        importlib.import_module(name)
    from fsrs import Optimizer
    Optimizer([])  # The library exposes a placeholder class when extras cannot import.
    from zoneinfo import ZoneInfo
    ZoneInfo('Asia/Shanghai')
    print('[paper-helper] Backend dependencies verified.')

if __name__=='__main__':
    try: main()
    except Exception as exc:
        print('[paper-helper] '+str(exc),file=sys.stderr)
        raise SystemExit(1) from None
