Set-StrictMode -Version 2.0

function Invoke-CheckedNative {
  param([string]$FilePath, [string[]]$Arguments, [string]$Step)
  $previousPreference=$ErrorActionPreference
  try { $ErrorActionPreference='Continue'; $global:LASTEXITCODE=$null; & $FilePath @Arguments 2>&1 | ForEach-Object { Write-Host $_ }; $nativeExitCode=$global:LASTEXITCODE }
  finally { $ErrorActionPreference=$previousPreference }
  if ($null -eq $nativeExitCode -or $nativeExitCode -ne 0) { throw "$Step failed (exit $nativeExitCode). Setup/startup has stopped." }
}

function Test-NativeProbe {
  param([string]$FilePath, [string[]]$Arguments)
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $FilePath @Arguments *> $null
    return ($LASTEXITCODE -eq 0)
  } catch { return $false } finally { $ErrorActionPreference = $previousPreference }
}

function Update-ToolPath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machinePath;$userPath;$env:Path"
}

function Find-ProjectPython {
  $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
  $pythonProbe = 'import sys; print(sys.executable); sys.exit(0 if sys.version_info >= (3,11) and sys.maxsize > 2**32 else 1)'
  $candidates = @()
  if ($launcher) {
    foreach ($selector in @('-3.11','-3.12','-3.13','-3')) {
      $previousPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        $output = & $launcher.Source $selector -c $pythonProbe 2>$null
        if ($LASTEXITCODE -eq 0 -and $output) { $candidates += [string]($output | Select-Object -Last 1) }
      } finally { $ErrorActionPreference = $previousPreference }
    }
  }
  $command = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($command -and $command.Source -notlike '*\WindowsApps\*') { $candidates += $command.Source }
  foreach ($candidate in $candidates | Select-Object -Unique) {
    if (Test-NativeProbe $candidate @('-c',$pythonProbe)) { return $candidate }
  }
  return $null
}

function Find-ProjectNode {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($node -and $npm -and (Test-NativeProbe $node.Source @('-e', 'process.exit(Number(process.versions.node.split(String.fromCharCode(46))[0])>=20?0:1)'))) {
    return @{ Node=$node.Source; Npm=$npm.Source }
  }
  return $null
}

function Install-ProjectTool {
  param([string]$Id, [string]$Label)
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) { throw "$Label is missing and WinGet is unavailable. Install Python 3.11+ (64-bit) from python.org and Node.js 20+ from nodejs.org, then rerun setup.bat." }
  Write-Host "[paper-helper] Installing $Label. Windows may request permission for the installer."
  Invoke-CheckedNative $winget.Source @('install','--id',$Id,'--exact','--source','winget','--accept-package-agreements','--accept-source-agreements','--disable-interactivity') "Installing $Label"
  Update-ToolPath
}

function Test-FrontendEnvironment {
  param([string]$Node, [string]$Frontend)
  return (Test-NativeProbe $Node @((Join-Path $PSScriptRoot 'verify-frontend.cjs'),$Frontend))
}
