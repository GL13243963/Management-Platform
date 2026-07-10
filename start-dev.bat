@echo off
title Innovation Center - Dev Mode

set ROOT=%~dp0
cd /d "%ROOT%"

echo Starting dev mode (hot reload)...
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:5173   ^<- open this one
echo.

start "backend" cmd /k "cd /d %ROOT%backend && npm start"
timeout /t 2 >nul
start "frontend" cmd /k "cd /d %ROOT%frontend && npm run dev"
