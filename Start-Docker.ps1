[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    $docker = (Get-Command docker.exe -ErrorAction Stop).Source
    if (-not (Test-Path -LiteralPath 'docker.env')) {
        Copy-Item -LiteralPath 'docker.env.example' -Destination 'docker.env'
        throw 'Created docker.env. Set APP_PASSWORD and POSTGRES_PASSWORD, then run this script again.'
    }
    $engine = & $docker info --format '{{.OSType}}'
    if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop and wait until the engine is ready.' }
    if ($engine -ne 'linux') { throw 'Switch Docker Desktop to Linux containers and run again.' }
    & $docker compose --env-file docker.env up -d --build --wait
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose startup failed. See the output above.' }
    & $docker compose --env-file docker.env ps
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the service status.' }
}
finally {
    Pop-Location
}
