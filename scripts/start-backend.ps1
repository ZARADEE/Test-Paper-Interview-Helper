param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
  [switch]$StartFrontend
)

$ErrorActionPreference = "Stop"
Set-Location $ProjectRoot

$python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$hostName = if ($env:PAPER_HELPER_API_HOST) { $env:PAPER_HELPER_API_HOST } else { "127.0.0.1" }
$port = if ($env:PAPER_HELPER_API_PORT) { $env:PAPER_HELPER_API_PORT } else { "8000" }

if (-not (Test-Path -LiteralPath $python)) {
  throw "Project Python environment was not found: $python"
}

Write-Host "[paper-helper] Starting FastAPI on http://${hostName}:${port}"
$backend = Start-Process -FilePath $python `
  -ArgumentList "-m", "uvicorn", "app.main:app", "--host", $hostName, "--port", $port `
  -WorkingDirectory (Join-Path $ProjectRoot "backend") `
  -PassThru -WindowStyle Hidden

try {
  $healthy = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -UseBasicParsing "http://${hostName}:${port}/api/health"
      if ($response.StatusCode -eq 200) {
        $healthy = $true
        break
      }
    } catch {}
  }

  if (-not $healthy) {
    throw "FastAPI health check timed out."
  }

  if ($StartFrontend) {
    Write-Host "[paper-helper] Starting Electron renderer..."
    Push-Location (Join-Path $ProjectRoot "frontend")
    try {
      npm.cmd run dev -- --noSandbox
      if ($LASTEXITCODE -ne 0) {
        throw "Electron development process exited with code $LASTEXITCODE. See the terminal output and frontend logs."
      }
    } finally {
      Pop-Location
    }
  } else {
    Wait-Process -Id $backend.Id
  }
} finally {
  if (-not $backend.HasExited) {
    Stop-Process -Id $backend.Id -Force
  }
}
