@echo off
setlocal
cd /d "%~dp0"
echo === FAKEPLANT ORGO / ACCES SERVICE : CREATE ===
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_FAKEPLANT_SCOPED_ACCESS.ps1" -Create
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" echo [ECHEC] Creation ou verification refusee.
exit /b %CODE%
