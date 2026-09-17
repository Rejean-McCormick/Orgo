@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Orgo - Disable local auto-login

if not exist ".env" exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='.env'; $lines=Get-Content -LiteralPath $p; $out=@();" ^
  "foreach($line in $lines){ if($line -match '^\s*ORGO_LOCAL_AUTO_LOGIN\s*='){ $out += 'ORGO_LOCAL_AUTO_LOGIN=false' } else { $out += $line } };" ^
  "Set-Content -LiteralPath $p -Value $out -Encoding utf8"
echo ORGO_LOCAL_AUTO_LOGIN=false
pause
