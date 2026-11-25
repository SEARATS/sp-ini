param(
    [string]$GameDirectory = (Join-Path ${env:ProgramFiles(x86)} 'Steam/steamapps/common/Sea Power'),
    [string]$BlenderPath,
    [string]$OutputDirectory = (Join-Path ([IO.Path]::GetTempPath()) 'sp-ini-feature-gallery')
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$game = (Resolve-Path -LiteralPath $GameDirectory).Path
$out = [IO.Path]::GetFullPath($OutputDirectory)
$session = Join-Path ([IO.Path]::GetTempPath()) ('sp-ini-gallery-' + [guid]::NewGuid())
$folder = Join-Path $session 'workspace'
New-Item -ItemType Directory -Force -Path $folder,$out | Out-Null
Push-Location $repo
try {
    pnpm run build
    if ($LASTEXITCODE) { throw 'Extension build failed.' }
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        uv run scripts/gallery/stock_assets.py "$game" "$folder"
    } else {
        python scripts/gallery/stock_assets.py "$game" "$folder"
    }
    if ($LASTEXITCODE) { throw 'Stock asset export failed. Use uv or install UnityPy 1.25.4 in your Python environment.' }

    if (!$BlenderPath) {
        $BlenderPath = (Get-Command blender -ErrorAction SilentlyContinue | Select-Object -First 1).Source
        if (!$BlenderPath) {
            $BlenderPath = Get-ChildItem "$env:ProgramFiles/Blender Foundation/Blender */blender.exe" -ErrorAction SilentlyContinue |
                Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
        }
    }
    if ($BlenderPath) {
        & $BlenderPath --background --factory-startup --python-exit-code 1 --python "$PSScriptRoot/gallery/stock_fbx.py" -- "$folder/ships/usn_dd_spruance_vls/spruance_vls_exterior.obj"
        if ($LASTEXITCODE) { throw 'Stock FBX export failed.' }
    } else { Write-Warning 'Install Blender or pass -BlenderPath to include the FBX screenshot.' }

    $workspace = Join-Path $session 'Gallery.code-workspace'
    @{folders=@(@{path=$folder});settings=@{
        'files.associations'=@{'*.ini'='seapower-ini'}
        'seapowerIni.gameDirectory'=$game
        'editor.fontSize'=16
        'editor.minimap.enabled'=$false
        'editor.stickyScroll.enabled'=$false
        'workbench.colorTheme'='Default Dark Modern'
        'workbench.startupEditor'='none'
    }} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $workspace
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    $env:SP_GALLERY_PORT = "$port"
    $env:SP_GALLERY_OUTPUT = $out
    $env:SP_GALLERY_GAME = $game
    $env:SP_GALLERY_RESULT = Join-Path $session 'result'
    code --user-data-dir "$session/profile" --extensions-dir "$session/extensions" --extensionDevelopmentPath "$repo" --extensionTestsPath "$PSScriptRoot/gallery/capture.js" "--remote-debugging-port=$port" --skip-welcome --disable-workspace-trust --new-window --wait "$workspace"
    if (!(Test-Path -LiteralPath $env:SP_GALLERY_RESULT)) { throw "Capture stopped. See $session/profile/logs." }
    $result = Get-Content -LiteralPath $env:SP_GALLERY_RESULT -Raw
    if ($result -ne 'ok') { throw $result }
    Write-Output (Join-Path $out 'index.html')
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')
    $target = (Resolve-Path -LiteralPath $session).Path
    if ([IO.Path]::GetDirectoryName($target) -eq $tempRoot -and [IO.Path]::GetFileName($target) -match '^sp-ini-gallery-[0-9a-f-]{36}$') {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
} finally { Pop-Location }
