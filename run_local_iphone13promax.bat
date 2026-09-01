@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if not %errorlevel%==0 (
    echo Node.js was not found.
    pause
    exit /b 1
)

if not exist "node_modules\.bin\esbuild.cmd" (
    call npm ci
    if not %errorlevel%==0 (
        pause
        exit /b 1
    )
)

echo Building the current local version...
call npm run build:web
if not %errorlevel%==0 (
    pause
    exit /b 1
)

set "STARTED_SERVER=0"
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not %errorlevel%==0 (
    echo Starting the ThinkStock local server...
    start "ThinkStock Local Server" /min node scripts\local_pages_server.mjs --host 0.0.0.0 --port 8787
    set "STARTED_SERVER=1"
)

:wait_for_server
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not %errorlevel%==0 (
    timeout /t 1 /nobreak >nul
    goto wait_for_server
)

set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if not defined BROWSER (
    echo Chrome or Edge was not found.
    pause
    exit /b 1
)

rem Uses the actual pixel dimensions of the manually adjusted reference capture.
set "PREVIEW_PROFILE=%LOCALAPPDATA%\ThinkStock\iPhonePreviewProfile"
start "" "%BROWSER%" --user-data-dir="%PREVIEW_PROFILE%" --no-first-run --no-default-browser-check --app="http://127.0.0.1:8787/?iphone13promax=1" --window-size=1109,1990 --window-position=0,0
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\resize_preview_window.ps1 -Width 1109 -Height 1990 -Left 0 -Top 0

echo.
echo iPhone 13 Pro Max ratio preview opened.
if "%STARTED_SERVER%"=="1" echo The minimized local server window must remain open.
timeout /t 3 /nobreak >nul
endlocal
