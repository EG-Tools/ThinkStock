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

%PY_CMD% -c "import streamlit" >nul 2>nul
if not %errorlevel%==0 (
    echo Installing required packages...
    %PY_CMD% -m pip install -r requirements.txt
    if not %errorlevel%==0 (
        echo Failed to install required packages.
        pause
        exit /b 1
    )
)

start "" cmd /c "timeout /t 3 >nul && start http://localhost:8501"
%PY_CMD% -m streamlit run streamlit_app.py --server.headless true --server.address 0.0.0.0 --server.port 8501
if not %errorlevel%==0 pause
endlocal
