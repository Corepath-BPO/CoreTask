<#
.SYNOPSIS
  Stop the host-mode CoreTask services started by dev-local.ps1.

.DESCRIPTION
  Ends the API, worker and Vite processes (and the PowerShell windows that host
  them). The infra containers keep running unless -Infra is given.

.PARAMETER Infra
  Also stop the PostgreSQL, Redis and MinIO containers.
#>
param(
  [switch]$Infra
)

$root = Split-Path -Parent $PSScriptRoot
$escaped = [regex]::Escape($root)

$procs = Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'node.exe' -and $_.CommandLine -match "$escaped|dist[\\/]worker\.js") -or
  ($_.Name -in 'powershell.exe', 'cmd.exe' -and $_.CommandLine -match 'CoreTask (API|worker|web)|pnpm (dev|worker)|dist[\\/]worker\.js')
}

if (-not $procs) {
  Write-Host 'No host-mode CoreTask processes found.'
} else {
  foreach ($p in $procs) {
    Write-Host ("  stopping {0,-14} pid {1}" -f $p.Name, $p.ProcessId)
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

if ($Infra) {
  & docker compose -f "$root\docker-compose.yml" -f "$root\docker-compose.dev.yml" stop coretask-postgres coretask-redis coretask-minio
}
