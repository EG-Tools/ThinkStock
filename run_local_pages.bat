@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if not %errorlevel%==0 (
    echo Node.js was not found.
    echo Install Node.js 20 or later and try again.
    pause
    exit /b 1
)

if not exist "node_modules\.bin\esbuild.cmd" (
    echo Installing local web dependencies...
    call npm ci
    if not %errorlevel%==0 (
        echo Failed to install local web dependencies.
        pause
        exit /b 1
    )
)

if /i not "%~1"=="--skip-build" (
    echo Building the current local version...
    call npm run build:web
    if not %errorlevel%==0 (
        echo The local web build failed.
        pause
        exit /b 1
    )
)

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if %errorlevel%==0 (
    echo Restarting the existing local server...
    powershell -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/api/shutdown' -TimeoutSec 2 | Out-Null } catch {}" >nul 2>nul
    timeout /t 1 >nul
)

start "" cmd /c "timeout /t 2 >nul && start http://127.0.0.1:8787"
node scripts\local_pages_server.mjs --host 0.0.0.0 --port 8787
if not %errorlevel%==0 pause
endlocal
