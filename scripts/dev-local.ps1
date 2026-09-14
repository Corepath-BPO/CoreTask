<#
.SYNOPSIS
  Run CoreTask on the host with only PostgreSQL, Redis and MinIO in Docker.

.DESCRIPTION
  A lighter alternative to `pnpm dev` for small laptops. The API, worker and
  Vite dev server run natively with normal file watching, instead of polling
  watchers inside bind-mounted containers. Each service gets its own PowerShell
  window so its logs stay visible; close the window to stop it.

  See README, "Running locally without Docker".

.PARAMETER BuildPackages
  Rebuild packages/* first. Needed after editing a shared package.

.PARAMETER Seed
  Run the database seed after migrations (first run on an empty database).

.PARAMETER NoBrowser
  Do not open http://localhost:5173 once the web server answers.

.PARAMETER LogDir
  Also write each service's output to <LogDir>\api.log, worker.log and web.log.

.EXAMPLE
  .\scripts\dev-local.ps1
  .\scripts\dev-local.ps1 -BuildPackages
#>
param(
  [switch]$BuildPackages,
  [switch]$Seed,
  [switch]$NoBrowser,
  [string]$LogDir
)

$root = Split-Path -Parent $PSScriptRoot
$compose = @('compose', '-f', "$root\docker-compose.yml", '-f', "$root\docker-compose.dev.yml")
$dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'

# On machines without a global pnpm, corepack shims live here
# (created with: corepack enable --install-directory "$env:USERPROFILE\.corepack-bin").
$shims = Join-Path $env:USERPROFILE '.corepack-bin'
if ((Test-Path $shims) -and ($env:PATH -notlike "*$shims*")) { $env:PATH = "$shims;$env:PATH" }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error 'pnpm not found. Run: corepack enable --install-directory "$env:USERPROFILE\.corepack-bin"'
  exit 1
}

function Test-Docker {
  try { $null = & docker info --format '{{.ServerVersion}}' 2>&1; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

function Test-Healthy([string]$Container) {
  try { return ((& docker inspect -f '{{.State.Health.Status}}' $Container 2>&1) -eq 'healthy') } catch { return $false }
}

function Test-Http([string]$Url) {
  try { return ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $Url).StatusCode -eq 200) } catch { return $false }
}

function Wait-Until([string]$What, [scriptblock]$Test, [int]$TimeoutSec) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (& $Test) { Write-Host "  $What ready" -ForegroundColor Green; return }
    Start-Sleep -Seconds 2
  }
  Write-Error "$What not ready after ${TimeoutSec}s"
  exit 1
}

function Start-ServiceWindow([string]$Title, [string]$Dir, [string]$Command, [string]$LogName) {
  if ($LogDir) {
    # cmd merges stderr into stdout first, so the log gets plain text rather than
    # PowerShell error records for every line a tool writes to stderr. Add-Content
    # rather than Tee-Object because Windows PowerShell's Tee-Object writes UTF-16.
    $log = "$LogDir\$LogName.log"
    $Command = "cmd /c `"$Command 2>&1`" | ForEach-Object { `$_; Add-Content -Path '$log' -Value `$_ -Encoding UTF8 }"
  }
  $ps = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$Dir'; $Command"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $ps | Out-Null
  Write-Host "  '$Title' started in a new window"
}

if ($LogDir) { New-Item -ItemType Directory -Force $LogDir | Out-Null }

Write-Host '1/5 Docker daemon' -ForegroundColor Cyan
if (Test-Docker) {
  Write-Host '  already running'
} else {
  Start-Process $dockerDesktop
  Wait-Until 'Docker daemon' { Test-Docker } 150
}

Write-Host '2/5 Infra containers (postgres, redis, minio)' -ForegroundColor Cyan
& docker @compose up -d coretask-postgres coretask-redis coretask-minio
if ($LASTEXITCODE -ne 0) { exit 1 }
Wait-Until 'PostgreSQL' { Test-Healthy 'coretask-postgres' } 90
Wait-Until 'Redis' { Test-Healthy 'coretask-redis' } 60

if ($BuildPackages) {
  Write-Host '    building shared packages' -ForegroundColor Cyan
  Push-Location $root
  pnpm packages:build
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { exit 1 }
}

Write-Host '3/5 Database migrations' -ForegroundColor Cyan
Push-Location "$root\api"
pnpm exec dotenv -e ../.env -- prisma migrate deploy
$code = $LASTEXITCODE
if ($code -eq 0 -and $Seed) { pnpm db:seed; $code = $LASTEXITCODE }
Pop-Location
if ($code -ne 0) { exit 1 }

Write-Host '4/5 API and worker' -ForegroundColor Cyan
Start-ServiceWindow 'CoreTask API' "$root\api" 'pnpm dev' 'api'
Wait-Until 'API' { Test-Http 'http://localhost:3000/api/v1/health' } 240
# The worker runs from the API's compiled output instead of its own
# `nest start --watch`: a second compiler would wipe and rewrite the shared
# api/dist while the API is restarting (it crashed with "Cannot find module
# dist/main" that way), and it costs another ~450 MB. Node's own watch mode
# restarts the worker whenever the API compiler rewrites a file it loaded.
Wait-Until 'API build output' { Test-Path "$root\api\dist\worker.js" } 30
# Absolute path so the process is recognisable (and stoppable) by its command line.
Start-ServiceWindow 'CoreTask worker' "$root\api" "node --watch --enable-source-maps `"$root\api\dist\worker.js`"" 'worker'

Write-Host '5/5 Web' -ForegroundColor Cyan
Start-ServiceWindow 'CoreTask web' "$root\web" 'pnpm dev' 'web'
Wait-Until 'Web' { Test-Http 'http://localhost:5173/' } 120

if (-not $NoBrowser) { Start-Process 'http://localhost:5173/' }

Write-Host ''
Write-Host 'CoreTask is up:  http://localhost:5173   (API http://localhost:3000)' -ForegroundColor Green
Write-Host 'To stop: close the three service windows. The infra containers can stay up, or run `pnpm down`.'
