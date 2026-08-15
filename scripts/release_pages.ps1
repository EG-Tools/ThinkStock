param(
  [string]$Message = "release: deploy ThinkStock",
  [switch]$SkipVerification,
  [switch]$RefreshData,
  [switch]$KeepVersion,
  [switch]$PreparedCommit
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE"
  }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git is required." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required." }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI is required." }

$Branch = (& git branch --show-current).Trim()
if ($Branch -ne "main") { throw "Pages releases must run from main, not $Branch." }

Invoke-Checked git @("diff", "--check")
$HeadCommit = (& git rev-parse HEAD).Trim()
$RemoteCommit = (& git rev-parse origin/main).Trim()
if ($PreparedCommit -and $HeadCommit -ne $RemoteCommit) {
  throw "Prepared releases require HEAD to match origin/main."
}
$GitHubVerificationScope = "smoke"
Invoke-Checked npm @("run", "check:ai-validation")
if (-not $SkipVerification) {
  Invoke-Checked npm @("run", "verify:release")
}
if (-not $KeepVersion) {
  Invoke-Checked npm @("run", "version:pages")
}
Invoke-Checked npm @("run", "build:web")
Invoke-Checked node @("scripts/validate_pages_app.mjs")
Invoke-Checked git @(
  "add", "--",
  ".github",
  ".gitignore",
  "deploy_pages.bat",
  "docs",
  "package.json",
  "package-lock.json",
  "playwright.config.mjs",
  "requirements-pages.txt",
  "requirements-qlib.txt",
  "run_local_pages.bat",
  "scripts",
  "shared",
  "tests",
  "worker",
  ":(exclude)scripts/resize_preview_window.ps1"
)

& git diff --cached --quiet
if ($PreparedCommit) {
  if ($LASTEXITCODE -eq 1) {
    throw "The prepared commit does not contain the reproducible release output."
  }
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the prepared release." }
} else {
  if ($LASTEXITCODE -eq 0) { throw "There are no release changes to commit." }
  if ($LASTEXITCODE -ne 1) { throw "Unable to inspect staged release changes." }
  Invoke-Checked git @("commit", "-m", $Message)
  Invoke-Checked git @("push", "origin", "main")
}
Invoke-Checked gh @(
  "workflow", "run", "deploy-pages.yml", "--ref", "main",
  "-f", "release_title=$Message",
  "-f", "refresh_data=$($RefreshData.IsPresent.ToString().ToLowerInvariant())",
  "-f", "verification_scope=$GitHubVerificationScope"
)

Start-Sleep -Seconds 2
$LatestRunJson = & gh run list --workflow deploy-pages.yml --limit 1 --json url,status
if ($LASTEXITCODE -ne 0) { throw "Unable to read the Pages deployment status." }
$LatestRun = $LatestRunJson | ConvertFrom-Json | Select-Object -First 1
if ($LatestRun) { Write-Output "$($LatestRun.status) $($LatestRun.url)" }
