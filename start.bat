@echo off
setlocal
title Innovation Center V2
set "ROOT=%~dp0"
cd /d "%ROOT%"
call "%ROOT%tools\use-v2-runtime.bat"
if errorlevel 1 (
  pause
  exit /b 1
)
if /i "%~1"=="--check" exit /b 0

if not exist "backend\node_modules" (
  pushd backend
  call npm ci
  if errorlevel 1 (
    popd
    pause
    exit /b 1
  )
  popd
)
if not exist "frontend\node_modules" (
  pushd frontend
  call npm ci
  if errorlevel 1 (
    popd
    pause
    exit /b 1
  )
  popd
)
pushd frontend
call npm run build
if errorlevel 1 (
  popd
  pause
  exit /b 1
)
popd
echo Starting V2 on http://127.0.0.1:3002
start "" http://127.0.0.1:3002
pushd backend
call npm run start:local
popd
pause
