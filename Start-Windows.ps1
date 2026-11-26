[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$previousServeDist = [Environment]::GetEnvironmentVariable('SERVE_DIST', 'Process')
Push-Location -LiteralPath $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath 'windows.env')) {
        Copy-Item -LiteralPath 'windows.env.example' -Destination 'windows.env'
        throw 'Created windows.env. Set the database connection and app password, then run again.'
    }
    if (-not (Test-Path -LiteralPath 'dist/index.html')) {
        throw 'Missing dist/index.html. Run npm.cmd ci and npm.cmd run build first.'
    }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $major = & $node -p 'Number(process.versions.node.split(".")[0])'
    if ($LASTEXITCODE -ne 0 -or [int]$major -lt 24) { throw 'Node.js 24 or later is required.' }
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    if (-not (Test-Path -LiteralPath 'node_modules/express/package.json') -or
        -not (Test-Path -LiteralPath 'node_modules/pg/package.json')) {
        & $npm ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    }
    $env:SERVE_DIST = '1'
    & $node --env-file=windows.env server/index.ts
    if ($LASTEXITCODE -ne 0) { throw 'The production server exited with an error.' }
}
finally {
    [Environment]::SetEnvironmentVariable('SERVE_DIST', $previousServeDist, 'Process')
    Pop-Location
}
