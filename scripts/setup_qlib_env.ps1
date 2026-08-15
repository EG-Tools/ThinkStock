param(
  [string]$PythonExecutable = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".thinkstock-cache\qlib-venv"
$venvPython = Join-Path $venv "Scripts\python.exe"
$requirements = Join-Path $root "requirements-qlib.txt"

function Resolve-Python {
  if ($PythonExecutable -and (Test-Path -LiteralPath $PythonExecutable)) {
    return (Resolve-Path -LiteralPath $PythonExecutable).Path
  }
  $commands = @("python", "python3")
  foreach ($command in $commands) {
    $resolved = Get-Command $command -ErrorAction SilentlyContinue
    if ($resolved) { return $resolved.Source }
  }
  $codexPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  if (Test-Path -LiteralPath $codexPython) { return $codexPython }
  throw "Python 3.8-3.12 was not found. Install Python or pass -PythonExecutable."
}

if (-not (Test-Path -LiteralPath $venvPython)) {
  $python = Resolve-Python
  & $python -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw "Failed to create the Qlib virtual environment." }
}

& $venvPython -m pip install --disable-pip-version-check -r $requirements
if ($LASTEXITCODE -ne 0) { throw "Failed to install Qlib requirements." }
& $venvPython -c "import qlib, lightgbm; print(f'Qlib {qlib.__version__}, LightGBM {lightgbm.__version__}')"
if ($LASTEXITCODE -ne 0) { throw "Qlib import validation failed." }
