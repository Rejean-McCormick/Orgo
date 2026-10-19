@echo off
setlocal
set "ROOT=%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
  py -3 "%ROOT%tools\tandem_tour\installer.py" verify
) else (
  python "%ROOT%tools\tandem_tour\installer.py" verify
)
set "CODE=%errorlevel%"
echo.
if not "%CODE%"=="0" echo [ECHEC] Code %CODE% - aucun deploiement.
pause
exit /b %CODE%
