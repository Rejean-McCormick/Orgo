@echo off
setlocal
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_FAKEPLANT_IK_E2E_FIX.ps1"
if errorlevel 1 exit /b 1
exit /b 0
