param([Parameter(Mandatory, Position=0)][string]$Workspace)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$folder = (Resolve-Path -LiteralPath $Workspace).Path
$profile = Join-Path $env:LOCALAPPDATA 'sp-ini-dev-profile'
$env:SEAPOWER_DEV_RELOAD = '1'
Push-Location $root
try {
    pnpm run build
    if ($LASTEXITCODE) { throw 'Build failed.' }
    $watcher = Start-Process node -ArgumentList 'scripts/build.js --watch' -WorkingDirectory $root -WindowStyle Hidden -PassThru
    try {
        code --user-data-dir "$profile" --extensionDevelopmentPath "$root" --new-window --wait "$folder"
    } finally { if (!$watcher.HasExited) { $watcher.Kill() } }
} finally { Pop-Location }
