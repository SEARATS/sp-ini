$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$session = Join-Path ([IO.Path]::GetTempPath()) ('seapower-preview-' + [guid]::NewGuid())
$mod = Join-Path $session 'preview-fixture'
$env:SEA_POWER_DIR = Join-Path $session 'steamapps/common/Sea Power'
$vanilla = Join-Path $env:SEA_POWER_DIR 'Sea Power_Data/StreamingAssets/original/vessels'
$workshop = Join-Path $session 'steamapps/workshop/content/1286220/12345/vessels'
foreach ($dir in @("$mod/missions", $vanilla, $workshop)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
Set-Content -LiteralPath "$vanilla/stock_sample.ini" -Value @('[General]', 'UnitType=Vessel')
Set-Content -LiteralPath "$workshop/workshop_sample.ini" -Value @('[General]', 'UnitType=Vessel')
Set-Content -LiteralPath "$mod/missions/demo.ini" -Value @('[Mission]', '[Taskforce1Vessel1]', 'Type=stock_sample', '[Taskforce1Vessel2]', 'Type=workshop_sample')
New-Item -ItemType Directory -Path "$mod/.vscode" | Out-Null
New-Item -ItemType Directory -Path "$mod/vessels" | Out-Null
Set-Content -LiteralPath "$mod/vessels/mesh.ini" -Value @('[Models]', 'ResourcesFolder=.', 'ResourcesRoot=mesh.obj', '[Part]', 'Mesh=Part', '[General]', 'ArmorType=Typo')
Set-Content -LiteralPath "$mod/mesh.obj" -Value @('v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'o Part', 'f 1 2 3')
New-Item -ItemType Directory -Path "$mod/nested-mod" | Out-Null
Set-Content -LiteralPath "$mod/nested-mod/_info.ini" -Value '[General]'
Set-Content -LiteralPath "$mod/nested-mod/sonar.ini" -Value @('[SensorData]', "BladesCount=5  //number of blades on vessel's propulsion systems", 'MinNoiseClassificationTreshold=5 //in dBs, the minimal value of noise on sonar system')
Set-Content -LiteralPath "$mod/unrelated.ini" -Value '[General]'
Set-Content -LiteralPath "$mod/.vscode/settings.json" -Value '{"files.associations":{"**/missions/*.ini":"seapower-ini","**/vessels/*.ini":"seapower-ini"}}'
code --user-data-dir "$session/profile" --extensions-dir "$session/extensions" --extensionDevelopmentPath "$project" --extensionTestsPath "$PSScriptRoot/preview-smoke.js" --disable-gpu --skip-welcome --new-window --wait "$mod"
$code = $LASTEXITCODE
Get-ChildItem -Path "$session/profile/logs/*/window*/exthost/exthost.log" | Get-Content -Tail 3
if (!(Test-Path -LiteralPath "$mod/preview-test-passed")) { throw "Editor assertions did not finish. See $session/profile/logs" }
exit $code
