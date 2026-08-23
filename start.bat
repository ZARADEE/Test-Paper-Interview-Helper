@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [paper-helper] Checking local tools...

if not exist ".venv\Scripts\python.exe" (
  python --version >nul 2>nul
  if errorlevel 1 (
    echo [paper-helper] Python was not found. Install Python 3.11 or newer.
    goto :fail
  )
  echo [paper-helper] Creating Python virtual environment...
  python -m venv .venv
  if errorlevel 1 goto :fail
)

".venv\Scripts\python.exe" -c "import fastapi, uvicorn, fitz, docx, reportlab" >nul 2>nul
if errorlevel 1 (
  echo [paper-helper] Installing backend dependencies...
  ".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
  if errorlevel 1 goto :fail
)

node --version >nul 2>nul
if errorlevel 1 (
  echo [paper-helper] Node.js was not found. Install Node.js 20 or newer.
  goto :fail
)

if not exist "frontend\node_modules\electron\dist\electron.exe" (
  echo [paper-helper] Installing frontend dependencies...
  call npm.cmd --prefix frontend install
  if errorlevel 1 goto :fail
)

echo [paper-helper] Starting backend and Electron...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-backend.ps1" -ProjectRoot "%~dp0." -StartFrontend
if errorlevel 1 goto :fail
exit /b 0

:fail
set "FAIL_CODE=%errorlevel%"
if "%FAIL_CODE%"=="0" set "FAIL_CODE=1"
echo [paper-helper] Startup failed with exit code %FAIL_CODE%.
echo [paper-helper] Press any key to close this window.
pause
exit /b %FAIL_CODE%
