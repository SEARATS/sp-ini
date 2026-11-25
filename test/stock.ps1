param(
    [string]$GameDirectory = (Join-Path ${env:ProgramFiles(x86)} 'Steam/steamapps/common/Sea Power'),
    [string]$Mirror
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$session = Join-Path ([IO.Path]::GetTempPath()) ('sp-ini-stock-test-' + [guid]::NewGuid())
$workspace = (New-Item -ItemType Directory -Path "$session/empty" -Force).FullName
$source = Join-Path $GameDirectory 'Sea Power_Data/StreamingAssets/original'
$env:SP_INI_MIRROR = '0'
$debugArgs = @()
if ($Mirror) {
    $workspace = (Resolve-Path -LiteralPath (Join-Path $Mirror 'Sea Power.code-workspace')).Path
    $source = Join-Path $Mirror 'Unity/ExportedProject/Assets/StreamingAssets/original'
    $env:SP_INI_MIRROR = '1'
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $listener.Start()
    try { $port = $listener.LocalEndpoint.Port } finally { $listener.Stop() }
    $env:SP_INI_CDP_PORT = $port
    $debugArgs += "--remote-debugging-port=$port"
}
$env:SP_INI_STOCK_INI = (Resolve-Path -LiteralPath (Join-Path $source 'vessels/usn_dd_spruance_vls.ini')).Path
$env:SP_INI_TEST_RESULT = "$session/result.txt"
Push-Location $repo
try {
    pnpm run build
    if ($LASTEXITCODE) { throw 'Build failed.' }
    code @debugArgs --user-data-dir "$session/profile" --extensions-dir "$session/extensions" --extensionDevelopmentPath "$repo" --extensionTestsPath "$repo/dist/dev/stock-smoke.js" --new-window --skip-welcome --wait "$workspace"
    if (!(Test-Path -LiteralPath $env:SP_INI_TEST_RESULT)) { throw "Stock checks failed. See $session/profile/logs." }
    Get-Content -LiteralPath $env:SP_INI_TEST_RESULT
} finally { Pop-Location }
