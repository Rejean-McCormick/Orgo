@echo off
setlocal
cd /d "%~dp0"
echo =====================================================
echo  ORGO - FAKEPLANT - ACL / IDENTITES - LECTURE SEULE
echo =====================================================
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\tandem\DIAG_FAKEPLANT_ACL.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo [ECHEC] Diagnostic non termine. Code: %RC%
echo [FIN] Aucun changement en base.
pause
exit /b %RC%
