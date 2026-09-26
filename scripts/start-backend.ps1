param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
  [switch]$StartFrontend
)

$ErrorActionPreference = "Stop"
Set-Location $ProjectRoot

$python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$backendHost = if ($env:PAPER_HELPER_API_HOST) { $env:PAPER_HELPER_API_HOST } else { "0.0.0.0" }
$port = if ($env:PAPER_HELPER_API_PORT) { $env:PAPER_HELPER_API_PORT } else { "8000" }
$frontendPort = if ($env:PAPER_HELPER_FRONTEND_PORT) { $env:PAPER_HELPER_FRONTEND_PORT } else { "5173" }

function Get-LanIPv4 {
  $configs = Get-NetIPConfiguration | Where-Object { $_.IPv4Address }
  foreach ($config in $configs | Where-Object { $_.IPv4DefaultGateway }) {
    foreach ($address in $config.IPv4Address) {
      $ip = $address.IPAddress
      if ($ip -and $ip -notlike "127.*" -and $ip -notlike "169.254.*") {
        return $ip
      }
    }
  }
  foreach ($config in $configs) {
    foreach ($address in $config.IPv4Address) {
      $ip = $address.IPAddress
      if ($ip -and $ip -notlike "127.*" -and $ip -notlike "169.254.*") {
        return $ip
      }
    }
  }
  return "127.0.0.1"
}

$mobileHost = Get-LanIPv4
$mobileUrl = "http://${mobileHost}:${frontendPort}"

$env:PAPER_HELPER_MOBILE_HOST = $mobileHost
$env:PAPER_HELPER_MOBILE_URL = $mobileUrl

if (-not (Test-Path -LiteralPath $python)) {
  throw "Project Python environment was not found: $python"
}

Write-Host "[paper-helper] Starting FastAPI on http://127.0.0.1:${port} and ${mobileUrl}/"
$backend = Start-Process -FilePath $python `
  -ArgumentList "-m", "uvicorn", "app.main:app", "--host", $backendHost, "--port", $port `
  -WorkingDirectory (Join-Path $ProjectRoot "backend") `
  -PassThru -WindowStyle Hidden

try {
  $healthy = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:${port}/api/health"
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
    Write-Host "[paper-helper] Mobile access URL: ${mobileUrl}"
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
