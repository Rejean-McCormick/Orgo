@echo off
setlocal
cd /d "%~dp0"
echo === FAKEPLANT ORGO / TEST CONTEXTE API ===
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_FAKEPLANT_SCOPED_ACCESS.ps1" -CheckApi
set "CODE=%ERRORLEVEL%"
exit /b %CODE%
