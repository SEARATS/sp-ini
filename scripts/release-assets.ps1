$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath "$root/package.json" | ConvertFrom-Json).version
$out = Join-Path $root 'release'
New-Item -ItemType Directory -Path $out -Force | Out-Null
Copy-Item -LiteralPath "$root/seapower-ini-$version.vsix" -Destination $out
Compress-Archive -LiteralPath "$root/dist/generate.js", "$root/dist/third-party-licenses.txt" -DestinationPath "$out/seapower-ini-generator-$version.zip" -Force
Compress-Archive -LiteralPath "$root/dist/pspad.js", "$root/pspad/README.txt" -DestinationPath "$out/seapower-ini-pspad-$version.zip" -Force
Compress-Archive -LiteralPath "$root/dist/server.js", "$root/notepadpp/config.ps1", "$root/notepadpp/README.md", "$root/dist/pngjs-LICENSE.txt", "$root/dist/jpeg-js-LICENSE.txt" -DestinationPath "$out/seapower-ini-notepadpp-$version.zip" -Force
