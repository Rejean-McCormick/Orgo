@echo off
cd /d "%~dp0"

docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Orgo could not start.
  echo Check Docker Desktop, then try again.
  echo.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3000/cases"
exit /b 0
