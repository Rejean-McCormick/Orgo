@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0tools\tandem_education_p5\manager.py" ROLLBACK
) else (
  python "%~dp0tools\tandem_education_p5\manager.py" ROLLBACK
)
set "rc=%errorlevel%"
if not "%rc%"=="0" (echo [ECHEC] Code: %rc% & pause)
exit /b %rc%
