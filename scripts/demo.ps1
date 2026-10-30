# One-command local demo for Windows: checks Docker, prepares .env, starts
# docker-compose.demo.yml, waits for the healthcheck and prints the links.
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')
$compose = @('compose', '-f', 'docker-compose.demo.yml')

function Fail($msg) { Write-Host "`n$msg" -ForegroundColor Red; exit 1 }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker not found. Install Docker Desktop.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker is not running. Start Docker Desktop and try again.' }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Fail "'docker compose' (v2) is missing. Update Docker Desktop." }

if (-not (Test-Path .env)) {
  Copy-Item .env.demo .env
  Write-Host '[demo] .env created from .env.demo'
}

function EnvVal($name) {
  $line = Get-Content .env | Where-Object { $_ -match "^$name=" } | Select-Object -Last 1
  if (-not $line) { return '' }
  return ($line -replace "^$name=", '').Trim("'")
}
$port = EnvVal 'APP_PORT'; if (-not $port) { $port = '8080' }
$adminUser = EnvVal 'ADMIN_USER'; if (-not $adminUser) { $adminUser = 'admin' }
$adminPass = EnvVal 'DEMO_ADMIN_PASS'

if (-not (Test-Path demo/db/demo.dump)) { Fail 'demo/db/demo.dump is missing - the repository was not cloned completely.' }
if (-not (Test-Path demo/uploads/covers)) { Fail 'demo/uploads is missing - the repository was not cloned completely.' }

# Port check (skipped when our own demo already listens there).
$running = docker @compose ps -q app 2>$null
# Docker may hold a just-released port for a moment (after demo-reset), so retry for ~5 s.
if (-not $running) {
  $busy = $true
  for ($i = 0; $i -lt 6 -and $busy; $i++) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $busy = $client.ConnectAsync('127.0.0.1', [int]$port).Wait(700) } catch { $busy = $false } finally { $client.Dispose() }
    if ($busy) { Start-Sleep -Seconds 1 }
  }
  if ($busy) { Fail "Port $port is taken. Set another one in .env, e.g. APP_PORT=8090, and run the script again." }
}

Write-Host '[demo] building and starting (first time 2-5 minutes: the image builds, the database is restored from the snapshot)...'
docker @compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail 'docker compose up failed.' }

Write-Host -NoNewline '[demo] waiting for the app'
$status = 'starting'
for ($i = 0; $i -lt 180; $i++) {
  $id = docker @compose ps -q app
  $status = docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $id 2>$null
  if ($status -eq 'healthy') { break }
  if ($status -eq 'unhealthy') { Write-Host ''; docker @compose logs --tail 50 app; Fail 'The app did not start (see the log above).' }
  Write-Host -NoNewline '.'
  Start-Sleep -Seconds 5
}
Write-Host ''
if ($status -ne 'healthy') { docker @compose logs --tail 50 app; Fail 'The app was not ready within 15 minutes.' }

$url = "http://localhost:$port"
Write-Host @"

  Podorozhnyky+ demo is running
  ---------------------------------------------
  Site:     $url
  Admin:    $url/admin   login: $adminUser   password: $adminPass
  API:      $url/docs
  Map:      $url/map
  Guides:   $url/guides
  ---------------------------------------------
  Reset to the snapshot: scripts\demo-reset.ps1    Stop: docker compose -f docker-compose.demo.yml down

"@
