param(
  [string]$ProjectRoot = (Join-Path $PSScriptRoot '..'),
  [switch]$InstallMissingTools,
  [switch]$SkipBuild,
  [switch]$CheckOnly
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'environment-common.ps1')
$transcribing=$false
try {
  $ProjectRoot=(Resolve-Path -LiteralPath $ProjectRoot).Path
  $frontend=Join-Path $ProjectRoot 'frontend'
  foreach($file in @('backend\requirements.txt','frontend\package.json','frontend\package-lock.json')) {
    if(-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $file) -PathType Leaf)) { throw "Incomplete project: $file is missing. Extract the entire project ZIP before running setup.bat." }
  }
  if(-not $CheckOnly){
    $logDir=Join-Path $ProjectRoot 'logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $logPath=Join-Path $logDir ('setup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.log')
    Start-Transcript -LiteralPath $logPath -Force | Out-Null
    $transcribing=$true
    Write-Host "[paper-helper] Setup log: $logPath"
  }
  Write-Host "[paper-helper] Project: $ProjectRoot"
  $tools=Find-ProjectNode
  if(-not $tools -and $InstallMissingTools -and -not $CheckOnly){ Install-ProjectTool 'OpenJS.NodeJS.LTS' 'Node.js LTS'; $tools=Find-ProjectNode }
  if(-not $tools){ throw 'Node.js 20+ and npm are required. Run setup.bat or install Node.js, then reopen the terminal.' }
  $python=Join-Path $ProjectRoot '.venv\Scripts\python.exe'
  $validVenv=(Test-Path -LiteralPath $python) -and (Test-NativeProbe $python @('-c','import sys; sys.exit(0 if sys.version_info >= (3,11) and sys.maxsize > 2**32 else 1)'))
  if(-not $validVenv){
    if($CheckOnly){throw 'Project Python environment is missing or broken. Run setup.bat.'}
    $basePython=Find-ProjectPython
    if(-not $basePython -and $InstallMissingTools){Install-ProjectTool 'Python.Python.3.11' 'Python 3.11 (64-bit)';$basePython=Find-ProjectPython}
    if(-not $basePython){throw 'Python 3.11+ (64-bit) is required. Run setup.bat or install Python, then reopen the terminal.'}
    $venv=Join-Path $ProjectRoot '.venv'
    if(Test-Path -LiteralPath $venv){
      $backup=Join-Path $ProjectRoot ('.venv.broken-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,6))
      if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($venv)) -ne $ProjectRoot -or [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($backup)) -ne $ProjectRoot){throw 'Environment backup path is outside the project.'}
      Move-Item -LiteralPath $venv -Destination $backup
      Write-Host "[paper-helper] Preserved the unusable environment at $backup"
    }
    Invoke-CheckedNative $basePython @('-m','venv',$venv) 'Creating Python virtual environment'
  }
  $backendCheck=Join-Path $PSScriptRoot 'verify-backend.py'
  if(-not (Test-NativeProbe $python @('-B',$backendCheck,$ProjectRoot))){
    if($CheckOnly){throw 'Backend dependencies are missing or do not match requirements.txt. Run setup.bat.'}
    Write-Host '[paper-helper] Installing backend dependencies...'
    Invoke-CheckedNative $python @('-m','pip','install','--disable-pip-version-check','-r',(Join-Path $ProjectRoot 'backend\requirements.txt')) 'Installing backend dependencies'
  }
  Invoke-CheckedNative $python @('-B',$backendCheck,$ProjectRoot) 'Checking backend dependencies'
  Invoke-CheckedNative $python @('-m','pip','check') 'Checking Python dependency compatibility'
  $frontendHash=(Get-FileHash -LiteralPath (Join-Path $frontend 'package-lock.json') -Algorithm SHA256).Hash
  $stamp=Join-Path $frontend 'node_modules\.paper-helper-lock'
  $stampValue=if(Test-Path -LiteralPath $stamp){(Get-Content -LiteralPath $stamp -Raw).Trim()}else{''}
  $sameLock=($stampValue -eq $frontendHash) -or $stampValue.StartsWith($frontendHash+':')
  $validFrontend=Test-FrontendEnvironment $tools.Node $frontend
  if(-not $validFrontend -or (-not $sameLock -and -not $CheckOnly)){
    if($CheckOnly){throw 'Frontend dependencies or Electron binary are missing. Run setup.bat.'}
    Write-Host "[paper-helper] Installing frontend dependencies in $frontend"
    if(-not $env:ELECTRON_MIRROR){$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'}
    Write-Host "[paper-helper] Electron download mirror: $env:ELECTRON_MIRROR"
    if($env:ELECTRON_SKIP_BINARY_DOWNLOAD){throw 'ELECTRON_SKIP_BINARY_DOWNLOAD is set. Clear it in this terminal so setup can install the desktop runtime.'}
    Push-Location -LiteralPath $frontend
    try {
      Invoke-CheckedNative $tools.Npm @('ci','--prefix',$frontend,'--include=dev','--ignore-scripts=false','--foreground-scripts','--no-audit','--no-fund') 'Installing frontend dependencies'
      if(-not (Test-Path -LiteralPath (Join-Path $frontend 'node_modules\electron\dist\electron.exe'))){
        Invoke-CheckedNative $tools.Node @((Join-Path $frontend 'node_modules\electron\install.js')) 'Downloading Electron binary'
      }
    } finally { Pop-Location }
    Invoke-CheckedNative $tools.Node @((Join-Path $PSScriptRoot 'verify-frontend.cjs'),$frontend) 'Checking frontend dependencies'
    Set-Content -LiteralPath $stamp -Value $frontendHash -Encoding ASCII
  } elseif($sameLock -and $stampValue -ne $frontendHash -and -not $CheckOnly){
    Set-Content -LiteralPath $stamp -Value $frontendHash -Encoding ASCII
  }
  if(-not $SkipBuild -and -not $CheckOnly){
    Write-Host '[paper-helper] Checking TypeScript and building the application...'
    Push-Location -LiteralPath $frontend
    try { Invoke-CheckedNative $tools.Npm @('run','build') 'TypeScript / production build' } finally { Pop-Location }
  }
  Push-Location -LiteralPath $frontend
  try { Invoke-CheckedNative $tools.Npm @('ls','--all','--include=dev','--depth=0') 'Checking installed frontend dependency tree' } finally { Pop-Location }
  Write-Host '[paper-helper] Environment ready.'
} catch {
  [Console]::Error.WriteLine('[paper-helper] '+$_.Exception.Message)
  if($transcribing){Stop-Transcript | Out-Null}
  exit 1
}
if($transcribing){Stop-Transcript | Out-Null}
exit 0
