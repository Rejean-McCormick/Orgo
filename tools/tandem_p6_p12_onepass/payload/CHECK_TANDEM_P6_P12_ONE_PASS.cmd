@echo off
setlocal
set "ORGO_ROOT=%~dp0."
for %%I in ("%ORGO_ROOT%\..\Orgo_Worlds") do set "WORLDS_ROOT=%%~fI"
node "%ORGO_ROOT%\tools\tandem-education\p6-p12\one-pass.mjs" --worlds "%WORLDS_ROOT%" %*
exit /b %errorlevel%
