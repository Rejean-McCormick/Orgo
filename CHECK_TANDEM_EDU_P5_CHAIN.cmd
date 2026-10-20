@echo off
setlocal
cd /d "%~dp0"
node "%~dp0tools\tandem-education\p5-cross-repo-check.mjs" "%~dp0..\Orgo_Worlds"
set "rc=%errorlevel%"
if not "%rc%"=="0" (echo [ECHEC] Code: %rc% & pause)
exit /b %rc%
