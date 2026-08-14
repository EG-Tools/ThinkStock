@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if not %errorlevel%==0 (
    echo Node.js was not found. Install Node.js 20 or later and try again.
    pause
    exit /b 1
)

if not exist "node_modules\.bin\esbuild.cmd" (
    echo Installing local web dependencies...
    call npm ci
    if not %errorlevel%==0 goto :failed
)

echo Testing the current local version...
call npm test
if not %errorlevel%==0 goto :failed

echo.
echo All local tests passed. Opening ThinkStock...
call "%~dp0run_local_pages.bat" --skip-build
exit /b %errorlevel%

:failed
echo.
echo Local tests failed. GitHub was not changed.
pause
exit /b 1
