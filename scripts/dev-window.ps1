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
    $watcher = Start-Process node -ArgumentList '--import tsx scripts/build.ts --watch' -WorkingDirectory $root -WindowStyle Hidden -PassThru
    try {
        code --user-data-dir "$profile" --extensionDevelopmentPath "$root" --reuse-window "$folder"
        if ($LASTEXITCODE) { throw 'VS Code failed to open the development window.' }
        # A window reload releases the CLI's --wait marker. The profile process survives it.
        $app = Get-CimInstance Win32_Process -Filter "Name = 'Code.exe'" | Where-Object {
            $_.CommandLine -like "*$profile*" -and $_.CommandLine -notlike '*--type=*'
        } | Select-Object -First 1
        if (!$app) { throw 'The VS Code development profile did not start.' }
        Wait-Process -Id $app.ProcessId -ErrorAction SilentlyContinue
    } finally { if (!$watcher.HasExited) { $watcher.Kill() } }
} finally { Pop-Location }
