@echo off
setlocal
cd /d "%~dp0"

where git >nul 2>nul
if not %errorlevel%==0 (
    echo Git was not found. Install Git for Windows and try again.
    pause
    exit /b 1
)

where node >nul 2>nul
if not %errorlevel%==0 (
    echo Node.js was not found. Install Node.js 20 or later and try again.
    pause
    exit /b 1
)

set "DIRTY="
for /f "delims=" %%i in ('git status --porcelain 2^>nul') do set "DIRTY=1"
if defined DIRTY (
    echo.
    echo Local changes were found. Nothing was downloaded to protect your work.
    echo Finish, commit, or discard those changes before updating from GitHub.
    echo.
    git status --short
    pause
    exit /b 2
)

echo Downloading the latest GitHub main version...
git fetch origin main
if not %errorlevel%==0 goto :failed

git merge --ff-only origin/main
if not %errorlevel%==0 goto :failed

echo Installing the exact dependency versions...
call npm ci
if not %errorlevel%==0 goto :failed

echo Building the downloaded version...
call npm run build:web
if not %errorlevel%==0 goto :failed

echo.
echo GitHub update and local installation completed.
echo Run run_local_pages.bat to open ThinkStock.
pause
exit /b 0

:failed
echo.
echo Update or installation failed. Existing local source files were not reset.
pause
exit /b 1
