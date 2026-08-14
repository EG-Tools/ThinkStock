@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_pages.ps1
) else (
  if /I "%~2"=="--prepared" (
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_pages.ps1 -Message "%~1" -KeepVersion -SkipVerification -PreparedCommit
  ) else if /I "%~2"=="--keep-version" (
    if /I "%~3"=="--skip-verified" (
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_pages.ps1 -Message "%~1" -KeepVersion -SkipVerification
    ) else (
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_pages.ps1 -Message "%~1" -KeepVersion
    )
  ) else if /I "%~2"=="--skip-verified" (
    if /I "%~3"=="--keep-version" (
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_pages.ps1 -Message "%~1" -SkipVerification -KeepVersion
    ) else if /I "%~3"=="--refresh-data" (
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_pages.ps1 -Message "%~1" -SkipVerification -RefreshData
    ) else (
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_pages.ps1 -Message "%~1" -SkipVerification
    )
  ) else if /I "%~2"=="--refresh-data" (
    if /I "%~3"=="--skip-verified" (
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_pages.ps1 -Message "%~1" -RefreshData -SkipVerification
    ) else (
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_pages.ps1 -Message "%~1" -RefreshData
    )
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_pages.ps1 -Message "%~1"
  )
)

set "exitCode=%errorlevel%"
if not "%exitCode%"=="0" pause
exit /b %exitCode%
