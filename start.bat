@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0"
if errorlevel 1 exit /b 1

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-environment.ps1" -ProjectRoot "%~dp0." -SkipBuild
if errorlevel 1 goto :fail

echo [paper-helper] Starting backend and Electron...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-backend.ps1" -ProjectRoot "%~dp0." -StartFrontend
if errorlevel 1 goto :fail
popd
exit /b 0

:fail
set "FAIL_CODE=%errorlevel%"
if "%FAIL_CODE%"=="0" set "FAIL_CODE=1"
echo [paper-helper] Startup stopped. Read the error above and logs in logs\.
echo [paper-helper] For a new computer, run setup.bat first.
if not defined PAPER_HELPER_NO_PAUSE pause
popd
exit /b %FAIL_CODE%
