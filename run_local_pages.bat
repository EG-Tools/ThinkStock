@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    set "PY_CMD=py"
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        set "PY_CMD=python"
    ) else (
        echo Python was not found.
        echo Install Python 3.10+ and check "Add python.exe to PATH".
        pause
        exit /b 1
    )
)

start "" cmd /c "timeout /t 2 >nul && start http://127.0.0.1:8787"
%PY_CMD% scripts\local_pages_server.py --host 0.0.0.0 --port 8787
if not %errorlevel%==0 pause
endlocal
