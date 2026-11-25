$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath "$root/package.json" | ConvertFrom-Json).version
$out = Join-Path $root 'release'
New-Item -ItemType Directory -Path $out -Force | Out-Null
Copy-Item -LiteralPath "$root/seapower-ini-$version.vsix" -Destination $out
Compress-Archive -LiteralPath "$root/dist/pspad.js", "$root/pspad/README.txt" -DestinationPath "$out/seapower-ini-pspad-$version.zip" -Force
