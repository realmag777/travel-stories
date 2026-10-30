# Throws away everything the demo changed (database and uploads volumes) and starts it again
# from demo/db/demo.dump and demo/uploads.
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')
Write-Host '[demo] удаляю данные демо (тома базы и uploads)...'
docker compose -f docker-compose.demo.yml down -v --remove-orphans
& (Join-Path $PSScriptRoot 'demo.ps1')
