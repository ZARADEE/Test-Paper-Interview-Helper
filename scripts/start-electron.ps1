param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $ProjectRoot "frontend")
npm.cmd run dev -- --noSandbox
