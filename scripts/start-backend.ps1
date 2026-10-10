param(
  [string]$ProjectRoot = (Join-Path $PSScriptRoot '..'),
  [switch]$StartFrontend,
  [switch]$HealthCheckOnly
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'environment-common.ps1')
$backend=$null

function Get-LanIPv4 {
  try {
    $configs=@(Get-NetIPConfiguration -ErrorAction Stop | Where-Object { $_.IPv4Address })
    foreach($config in @($configs | Where-Object { $_.IPv4DefaultGateway }) + $configs){
      foreach($address in $config.IPv4Address){
        $ip=$address.IPAddress
        if($ip -and $ip -notlike '127.*' -and $ip -notlike '169.254.*'){ return $ip }
      }
    }
  } catch { Write-Host '[paper-helper] LAN address unavailable; using localhost.' }
  return '127.0.0.1'
}
function Assert-FreePort([int]$PortNumber){
  if([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object { $_.Port -eq $PortNumber }){
    throw "Port $PortNumber is already in use. Close the other instance or choose another PAPER_HELPER port."
  }
}
try {
  $ProjectRoot=(Resolve-Path -LiteralPath $ProjectRoot).Path
  $python=Join-Path $ProjectRoot '.venv\Scripts\python.exe'
  $frontend=Join-Path $ProjectRoot 'frontend'
  $backendHost=if($env:PAPER_HELPER_API_HOST){$env:PAPER_HELPER_API_HOST}else{'0.0.0.0'}
  $port=if($env:PAPER_HELPER_API_PORT){$env:PAPER_HELPER_API_PORT}else{'8000'}
  $frontendPort=if($env:PAPER_HELPER_FRONTEND_PORT){$env:PAPER_HELPER_FRONTEND_PORT}else{'5173'}
  foreach($value in @($port,$frontendPort)){
    if($value -notmatch '^\d+$' -or [long]$value -lt 1 -or [long]$value -gt 65535){throw "Invalid port: $value"}
  }
  if($backendHost -notin @('0.0.0.0','127.0.0.1','localhost')){throw 'PAPER_HELPER_API_HOST must be 0.0.0.0, 127.0.0.1 or localhost.'}
  if(-not (Test-Path -LiteralPath $python)){throw 'Python environment missing. Run setup.bat first.'}
  Invoke-CheckedNative $python @('-B',(Join-Path $PSScriptRoot 'verify-backend.py'),$ProjectRoot) 'Checking backend dependencies'
  if($StartFrontend){
    $tools=Find-ProjectNode
    if(-not $tools -or -not (Test-FrontendEnvironment $tools.Node $frontend)){throw 'Frontend dependencies are incomplete. Run setup.bat first.'}
    Assert-FreePort ([int]$frontendPort)
  }
  Assert-FreePort ([int]$port)
  $mobileHost=Get-LanIPv4
  $mobileUrl='http://'+$mobileHost+':'+$frontendPort
  $env:PAPER_HELPER_MOBILE_HOST=$mobileHost
  $env:PAPER_HELPER_MOBILE_URL=$mobileUrl
  $env:PYTHONUNBUFFERED='1'
  $env:PYTHONUTF8='1'
  $logDir=Join-Path $ProjectRoot 'logs'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $runId=(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,6)
  $outLog=Join-Path $logDir "backend-$runId.out.log"
  $errLog=Join-Path $logDir "backend-$runId.err.log"
  Write-Host ('[paper-helper] Starting FastAPI on http://127.0.0.1:'+$port)
  Write-Host "[paper-helper] Backend logs: $outLog / $errLog"
  $backend=Start-Process -FilePath $python -ArgumentList @('-m','uvicorn','app.main:app','--host',$backendHost,'--port',$port) -WorkingDirectory (Join-Path $ProjectRoot 'backend') -PassThru -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  $healthy=$false
  $deadline=(Get-Date).AddSeconds(90)
  while((Get-Date) -lt $deadline){
    $backend.Refresh()
    if($backend.HasExited){throw "FastAPI exited before becoming ready. See $errLog"}
    try{
      $response=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$port+'/api/health') -TimeoutSec 2
      $backend.Refresh()
      if(-not $backend.HasExited -and $response.ok -eq $true -and $response.service -eq 'paper-helper'){$healthy=$true;break}
    }catch{}
    Start-Sleep -Milliseconds 500
  }
  if(-not $healthy){throw "FastAPI health check timed out. See $errLog"}
  Write-Host '[paper-helper] Backend health check passed.'
  if($HealthCheckOnly){Write-Host '[paper-helper] Health-check-only mode completed; stopping the test backend.'}
  elseif($StartFrontend){
    Write-Host "[paper-helper] Mobile access URL: $mobileUrl"
    Write-Host '[paper-helper] Starting Electron renderer...'
    Push-Location -LiteralPath $frontend
    try{Invoke-CheckedNative $tools.Npm @('run','dev','--','--noSandbox') 'Electron development process'}finally{Pop-Location}
  }else{Wait-Process -Id $backend.Id}
}catch{
  [Console]::Error.WriteLine('[paper-helper] '+$_.Exception.Message)
  exit 1
}finally{
  if($backend){$backend.Refresh();if(-not $backend.HasExited){Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue}}
}
exit 0
