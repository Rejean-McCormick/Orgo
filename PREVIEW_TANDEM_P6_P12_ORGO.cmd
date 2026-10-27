@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0tools\tandem_p6_p12_onepass\manager.py" PREVIEW
) else (
  python "%~dp0tools\tandem_p6_p12_onepass\manager.py" PREVIEW
)
set "rc=%errorlevel%"
if not "%rc%"=="0" (echo [ECHEC] Code: %rc%)
exit /b %rc%
