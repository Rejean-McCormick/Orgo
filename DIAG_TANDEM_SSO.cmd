@echo off
setlocal EnableExtensions
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo ERREUR: Node.js introuvable.
  pause
  exit /b 1
)
node tools\tandem\diag-sso.mjs
set "STATUS=%ERRORLEVEL%"
if not "%STATUS%"=="0" echo Diagnostic a verifier - aucun changement effectue.
pause
exit /b %STATUS%
