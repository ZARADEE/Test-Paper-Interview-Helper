"""Run backend regressions with all temporary artifacts inside this project."""
from pathlib import Path
import sys
import tempfile
import unittest

root = Path(__file__).resolve().parents[1]
temporary = root / 'frontend/out/timer-check/python-temp'
temporary.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(temporary)
sys.path[:0] = [str(root/'backend'),str(root/'backend/tests')]
pattern = sys.argv[1] if len(sys.argv)>1 else 'test_*.py'
result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.discover(str(root/'backend/tests'),pattern=pattern))
raise SystemExit(not result.wasSuccessful())
