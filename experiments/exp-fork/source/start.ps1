param([ValidateSet('study','calibration')][string]$Phase = 'study')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path "$PSScriptRoot" '../..')).Path
$runtimeFile = Join-Path "$PSScriptRoot" $(if ($Phase -eq 'study') { 'runtime.json' } else { 'calibration-runtime.json' })
if (Test-Path -LiteralPath "$runtimeFile") {
    $old = Get-Content -LiteralPath "$runtimeFile" -Raw | ConvertFrom-Json
    $running = Get-CimInstance Win32_Process -Filter "ProcessId=$($old.pid)"
    if ($running -and $running.CommandLine -match 'learning-lab[/\\]server\.mjs') {
        Write-Output $old.url
        exit 0
    }
}
$entry = Join-Path "$PSScriptRoot" 'server.mjs'
$argsForNode = @(('"' + $entry + '"'), '0', $Phase)
$process = Start-Process -FilePath (Get-Command node).Source -ArgumentList $argsForNode -WorkingDirectory "$root" -WindowStyle Hidden -RedirectStandardOutput (Join-Path "$PSScriptRoot" "$Phase.stdout.log") -RedirectStandardError (Join-Path "$PSScriptRoot" "$Phase.stderr.log") -PassThru
for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 250
    $process.Refresh()
    if ($process.HasExited) { throw (Get-Content -LiteralPath (Join-Path "$PSScriptRoot" "$Phase.stderr.log") -Raw) }
    if (Test-Path -LiteralPath "$runtimeFile") {
        $runtime = Get-Content -LiteralPath "$runtimeFile" -Raw | ConvertFrom-Json
        if ($runtime.pid -eq $process.Id) { Write-Output $runtime.url; exit 0 }
    }
}
throw 'Startup did not finish within 20 seconds; inspect the local stderr log before retrying.'
