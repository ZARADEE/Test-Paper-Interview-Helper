@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0"
if errorlevel 1 exit /b 1
echo [paper-helper] One-click setup. Internet is needed on first use.
echo [paper-helper] Missing Python / Node.js can be installed through WinGet.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-environment.ps1" -ProjectRoot "%~dp0." -InstallMissingTools
if errorlevel 1 goto :fail
echo [paper-helper] Setup passed. Double-click start.bat to open the app.
if not defined PAPER_HELPER_NO_PAUSE pause
popd
exit /b 0
:fail
set "FAIL_CODE=%errorlevel%"
if "%FAIL_CODE%"=="0" set "FAIL_CODE=1"
echo [paper-helper] Setup failed. See the error above and logs\setup-*.log.
if not defined PAPER_HELPER_NO_PAUSE pause
popd
exit /b %FAIL_CODE%
