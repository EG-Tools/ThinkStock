param(
  [string]$Message = "release: deploy ThinkStock"
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
Invoke-Checked npm @("run", "verify:release")
Invoke-Checked npm @("run", "version:pages")
Invoke-Checked npm @("run", "build:web")
Invoke-Checked node @("scripts/validate_pages_app.mjs")
Invoke-Checked git @("add", "-A")

& git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { throw "There are no release changes to commit." }
if ($LASTEXITCODE -ne 1) { throw "Unable to inspect staged release changes." }

Invoke-Checked git @("commit", "-m", $Message)
Invoke-Checked git @("push", "origin", "main")
Invoke-Checked gh @(
  "workflow", "run", "deploy-pages.yml", "--ref", "main",
  "-f", "release_title=$Message"
)

Start-Sleep -Seconds 2
& gh run list --workflow deploy-pages.yml --limit 1 --json url,status --jq '.[0] | "\(.status) \(.url)"'
