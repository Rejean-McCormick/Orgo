@echo off
setlocal EnableExtensions
title Orgo - Launch

cd /d "%~dp0"

echo.
echo ==========================================
echo   ORGO - Docker launch
echo ==========================================
echo.

if not exist "docker-compose.yml" (
  echo [ERROR] docker-compose.yml not found.
  echo Put this BAT in: C:\mycode\Orgo\Orgo
  goto :fail
)

if not exist ".env" (
  echo [ERROR] .env not found.
  echo.
  echo Create it from .env.example and configure at least:
  echo   POSTGRES_PASSWORD
  echo   ORGO_ADMIN_PASSWORD
  echo   ORGO_ADMIN_EMAIL
  echo   ORGO_ORGANIZATION
  echo.
  echo No service was started.
  goto :fail
)

where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker is not installed or is not in PATH.
  goto :fail
)

docker info >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker Desktop / Docker Engine is not running.
  echo Start Docker, then run this BAT again.
  goto :fail
)

docker compose version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] "docker compose" is not available.
  goto :fail
)

set "WEB_PORT=3000"
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$p='3000'; Get-Content -LiteralPath '.env' | ForEach-Object { if ($_ -match '^\s*ORGO_WEB_HOST_PORT\s*=\s*([^#\s]+)') { $p=$matches[1].Trim() } }; Write-Output $p"`) do set "WEB_PORT=%%P"

echo [1/4] Building and starting Orgo...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo [ERROR] Docker Compose could not start Orgo.
  docker compose ps
  goto :fail
)

echo.
echo [2/4] Provisioning the administrator account...
echo       Existing administrator passwords are preserved by the seed.
docker compose --profile setup run --rm seed
if errorlevel 1 (
  echo.
  echo [ERROR] Administrator seed failed.
  echo Check ORGO_ADMIN_PASSWORD in .env ^(minimum 12 characters^).
  docker compose ps
  goto :fail
)

echo.
echo [3/4] Waiting for the web application...
powershell -NoProfile -Command ^
  "$url='http://127.0.0.1:%WEB_PORT%';" ^
  "$deadline=(Get-Date).AddSeconds(120);" ^
  "$ok=$false;" ^
  "while((Get-Date) -lt $deadline) {" ^
  "  try { $r=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){$ok=$true; break} } catch {};" ^
  "  Start-Sleep -Seconds 2" ^
  "};" ^
  "if(-not $ok){exit 1}"
if errorlevel 1 (
  echo.
  echo [ERROR] Orgo containers started, but the web UI did not become ready in 120 seconds.
  docker compose ps
  echo.
  echo To inspect logs:
  echo   docker compose logs --tail=100
  goto :fail
)

echo.
echo [4/4] Orgo is running.
echo.
docker compose ps
echo.
echo Web: http://127.0.0.1:%WEB_PORT%
echo.
echo Opening Orgo in your default browser...
start "" "http://127.0.0.1:%WEB_PORT%"

echo.
echo To stop Orgo later:
echo   cd /d C:\mycode\Orgo\Orgo
echo   docker compose down
echo.
echo Data is kept in the Docker volume unless you explicitly use "down -v".
echo.
pause
exit /b 0

:fail
echo.
echo Launch aborted.
echo.
pause
exit /b 1
