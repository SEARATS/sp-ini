param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
Push-Location $root
try {
    & $Python -m PyInstaller --noconfirm --onedir --name stock-reader --distpath dist --workpath dist/pybuild --specpath dist --exclude-module fmod_toolkit --exclude-module pyfmodex --collect-data archspec --collect-all UnityPy --copy-metadata UnityPy reader/stock_reader.py
    if ($LASTEXITCODE) { throw 'Stock reader build failed.' }
    & $Python scripts/reader_notices.py dist/stock-reader/THIRD-PARTY-NOTICES.txt
    if ($LASTEXITCODE) { throw 'Could not collect stock reader notices.' }
} finally { Pop-Location }
