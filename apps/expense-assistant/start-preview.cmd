@echo off
setlocal
pushd "%~dp0" || exit /b 1
set "V2_NODE=..\..\.runtime\node-v24.22.1-win-x64\node.exe"
set "V2_VITE=..\..\frontend\node_modules\vite\bin\vite.js"

if not exist "dist\index.html" (
    "%V2_NODE%" "%V2_VITE%" build
    if errorlevel 1 goto :failed
)

echo Starting preview. Use the Local URL printed below.
"%V2_NODE%" "%V2_VITE%" preview --host 127.0.0.1 --port 4181 --open
if errorlevel 1 goto :failed
popd
exit /b 0

:failed
echo Preview failed. See the error above.
pause
popd
exit /b 1
