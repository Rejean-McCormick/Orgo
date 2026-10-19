@echo off
setlocal
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_FAKEPLANT_FP_S01.ps1" -Mode Preview
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo [ECHEC] Preview FP-S01 refuse.
pause
exit /b %RESULT%
