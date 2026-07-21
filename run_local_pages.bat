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

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if %errorlevel%==0 (
    start "" http://127.0.0.1:8787
    exit /b 0
)

start "" cmd /c "timeout /t 2 >nul && start http://127.0.0.1:8787"
node scripts\local_pages_server.mjs --host 0.0.0.0 --port 8787
if not %errorlevel%==0 pause
endlocal
