@echo off
setlocal
set "PYTHONUTF8=1"
chcp 65001 >nul
where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  py -3 "%~dp0tools\tandem_education_p2\manager.py" INSTALL
) else (
  python "%~dp0tools\tandem_education_p2\manager.py" INSTALL
)
if errorlevel 1 (
  echo [FAIL] %ERRORLEVEL%
  exit /b 1
)
endlocal
