param(
  [string]$ProjectRoot = (Join-Path $PSScriptRoot '..')
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'environment-common.ps1')
try {
  $ProjectRoot=(Resolve-Path -LiteralPath $ProjectRoot).Path
  $frontend=Join-Path $ProjectRoot 'frontend'
  $tools=Find-ProjectNode
  if(-not $tools -or -not (Test-FrontendEnvironment $tools.Node $frontend)){throw 'Frontend environment is incomplete. Run setup.bat first.'}
  Push-Location -LiteralPath $frontend
  try { Invoke-CheckedNative $tools.Npm @('run','dev','--','--noSandbox') 'Electron development process' } finally { Pop-Location }
} catch {
  [Console]::Error.WriteLine('[paper-helper] '+$_.Exception.Message)
  exit 1
}
exit 0
