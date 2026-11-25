$ErrorActionPreference = 'Stop'
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$server = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'server.js')).Path
# A basic TOML string accepts JSON's escaping for Windows paths and quotes.
$executable = ConvertTo-Json -InputObject $node -Compress
$serverPath = ConvertTo-Json -InputObject $server -Compress
@"
[lspservers.ini]
mode = "io"
executable = $executable
args = "-e require(process.env.SP_INI_SERVER) -- sp-ini --stdio"
env = { SP_INI_SERVER = $serverPath }
initialization_options = '{"imagePreviews":false}'
auto_start_server = false
"@
