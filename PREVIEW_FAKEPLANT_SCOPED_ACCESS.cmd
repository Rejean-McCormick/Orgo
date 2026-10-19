@echo off
setlocal
cd /d "%~dp0"
echo === FAKEPLANT ORGO / ACCES SERVICE : PREVIEW ===
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_FAKEPLANT_SCOPED_ACCESS.ps1"
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" echo [ECHEC] Aucun jeton cree.
exit /b %CODE%
