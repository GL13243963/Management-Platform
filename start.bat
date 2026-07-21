@echo off
title Innovation Center Management

set ROOT=%~dp0
cd /d "%ROOT%"

echo ============================================================
echo   Innovation Center Management Platform
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js 22.5+ from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "backend\node_modules" (
  echo [1/4] First run: installing backend dependencies ...
  pushd backend
  call npm install
  if errorlevel 1 (
    echo Backend install failed.
    popd
    pause
    exit /b 1
  )
  popd
)

if not exist "frontend\node_modules" (
  echo [2/4] First run: installing frontend dependencies ...
  pushd frontend
  call npm install
  if errorlevel 1 (
    echo Frontend install failed.
    popd
    pause
    exit /b 1
  )
  popd
)

if not exist "frontend\dist\index.html" (
  echo [3/4] Building frontend ...
  pushd frontend
  call npm run build
  if errorlevel 1 (
    echo Frontend build failed.
    popd
    pause
    exit /b 1
  )
  popd
)

echo [4/4] Starting server on http://localhost:3001 ...
start "" http://localhost:3001
pushd backend
call npm start
popd

pause
