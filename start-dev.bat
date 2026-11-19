@echo off
setlocal
title Innovation Center V2 - Dev
set "ROOT=%~dp0"
cd /d "%ROOT%"
call "%ROOT%tools\use-v2-runtime.bat"
if errorlevel 1 (
  pause
  exit /b 1
)
if /i "%~1"=="--check" exit /b 0
echo V2 backend: http://127.0.0.1:3002
echo V2 frontend: http://127.0.0.1:5174
start "V2 backend" /D "%ROOT%backend" cmd /k npm run dev:local
start "V2 frontend" /D "%ROOT%frontend" cmd /k npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
