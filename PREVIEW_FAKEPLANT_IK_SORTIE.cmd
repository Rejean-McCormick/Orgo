@echo off
setlocal
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_FAKEPLANT_IK_SORTIE.ps1"
if errorlevel 1 echo [ECHEC] Aucun changement attendu avant la commande INSTALL.
if not defined KOA_NONINTERACTIVE pause
