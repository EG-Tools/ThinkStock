@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_pages.ps1
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_pages.ps1 -Message "%~1"
)

if not %errorlevel%==0 pause
exit /b %errorlevel%
