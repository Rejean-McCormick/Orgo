@echo off
setlocal
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_FAKEPLANT_FP_S01.ps1" -Mode Apply
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo [ECHEC] Test FP-S01 non valide : verifier avant relance.
pause
exit /b %RESULT%
