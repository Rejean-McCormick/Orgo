@echo off
setlocal
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_FAKEPLANT_IK_SORTIE.ps1" -Apply
if errorlevel 1 echo [ECHEC] Configuration IK non terminee. Ne pas tenter un evenement E2E.
if not defined KOA_NONINTERACTIVE pause
