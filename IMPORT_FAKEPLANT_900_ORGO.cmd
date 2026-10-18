@echo off
setlocal
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_FAKEPLANT_900_DOCKER_V2.ps1" -Apply
set "RC=%errorlevel%"
if not "%RC%"=="0" echo [ECHEC] Verifier les messages precedents.
pause
exit /b %RC%
