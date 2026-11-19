@echo off
set "V2_RUNTIME=%~dp0..\.runtime\node-v24.22.1-win-x64"
if not exist "%V2_RUNTIME%\node.exe" (
  echo [ERROR] V2 portable Node.js is missing. See docs for runtime setup.
  exit /b 1
)
set "PATH=%V2_RUNTIME%;%PATH%"
set "NODE_OPTIONS="
set "NODE_PATH="
set "APP_DB_PATH="
set "TOOL_MATRIX_RUNTIME_CONFIG="
set "TOOL_MATRIX_ASSET_ROOT="
set "RENDER_GALLERY_RUNTIME_CONFIG="
set "RENDER_GALLERY_ASSET_ROOT="
set "OPERATIONS_RUNTIME_CONFIG="
set "OPERATIONS_ASSET_ROOT="
set "UPDATE_DIR=%~dp0..\backend\data\local-updates"
set "NODE_ENV=development"
set "COOKIE_SECURE=false"
set "PORT=3002"
set "V2_BACKEND_PORT=3002"
set "V2_FRONTEND_PORT=5174"
node "%~dp0..\backend\scripts\check-runtime.js"
exit /b %errorlevel%

