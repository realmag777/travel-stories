# One-command local demo for Windows: checks Docker, prepares .env, starts
# docker-compose.demo.yml, waits for the healthcheck and prints the links.
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')
$compose = @('compose', '-f', 'docker-compose.demo.yml')

function Fail($msg) { Write-Host "`n$msg" -ForegroundColor Red; exit 1 }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker не найден. Установите Docker Desktop.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker не запущен. Запустите Docker Desktop и повторите.' }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Fail "Нет 'docker compose' (v2). Обновите Docker Desktop." }

if (-not (Test-Path .env)) {
  Copy-Item .env.demo .env
  Write-Host '[demo] .env создан из .env.demo'
}

function EnvVal($name) {
  $line = Get-Content .env | Where-Object { $_ -match "^$name=" } | Select-Object -Last 1
  if (-not $line) { return '' }
  return ($line -replace "^$name=", '').Trim("'")
}
$port = EnvVal 'APP_PORT'; if (-not $port) { $port = '8080' }
$adminUser = EnvVal 'ADMIN_USER'; if (-not $adminUser) { $adminUser = 'admin' }
$adminPass = EnvVal 'DEMO_ADMIN_PASS'

if (-not (Test-Path demo/db/demo.dump)) { Fail 'Нет demo/db/demo.dump — репозиторий склонирован не полностью.' }
if (-not (Test-Path demo/uploads/covers)) { Fail 'Нет demo/uploads — репозиторий склонирован не полностью.' }

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
  if ($busy) { Fail "Порт $port занят. Укажите другой в .env: APP_PORT=8090 — и запустите скрипт снова." }
}

Write-Host '[demo] сборка и запуск (первый раз 3–6 минут: образ собирается, база восстанавливается из снимка)...'
docker @compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail 'docker compose up завершился с ошибкой.' }

Write-Host -NoNewline '[demo] жду готовности'
$status = 'starting'
for ($i = 0; $i -lt 180; $i++) {
  $id = docker @compose ps -q app
  $status = docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $id 2>$null
  if ($status -eq 'healthy') { break }
  if ($status -eq 'unhealthy') { Write-Host ''; docker @compose logs --tail 50 app; Fail 'Приложение не поднялось (см. лог выше).' }
  Write-Host -NoNewline '.'
  Start-Sleep -Seconds 5
}
Write-Host ''
if ($status -ne 'healthy') { docker @compose logs --tail 50 app; Fail 'Не дождался готовности за 15 минут.' }

$url = "http://localhost:$port"
Write-Host @"

  Подорожники+ — демо запущено
  ─────────────────────────────────────────────
  Сайт:     $url
  Админка:  $url/admin   логин: $adminUser   пароль: $adminPass
  API:      $url/docs
  Карта:    $url/map
  Гиды:     $url/guides
  ─────────────────────────────────────────────
  Сброс к снимку: scripts\demo-reset.ps1    Остановить: docker compose -f docker-compose.demo.yml down

"@
