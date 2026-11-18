param(
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$BuildDirectory,
    [string]$Prefix = 'packaged',
    [int]$ThreeSeatSeconds = 600,
    [int]$OtherSeconds = 600,
    [ValidateSet(60,165)][int]$FirstRate = 60
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$electron = Join-Path $root 'node_modules/electron/dist/electron.exe'
$env:SERENITY_BOT_BUILD = (Resolve-Path -LiteralPath $BuildDirectory).Path
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:SERENITY_BOT_RIVAL_CONFIG -ErrorAction SilentlyContinue
Remove-Item Env:SERENITY_BOT_TIERS -ErrorAction SilentlyContinue
$dest = [System.IO.Directory]::CreateDirectory($OutputDirectory).FullName
foreach ($pass in @(1, 2)) {
    $otherRate = if ($FirstRate -eq 60) { 165 } else { 60 }
    $rates = if ($pass -eq 1) { @($FirstRate, $otherRate) } else { @($otherRate, $FirstRate) }
    foreach ($rate in $rates) {
        foreach ($seats in @('3', '4', '1', 'odyssey')) {
            $seconds = if ($seats -eq '3') { $ThreeSeatSeconds } else { $OtherSeconds }
            $stem = Join-Path $dest ("$Prefix-$pass-$seats-$rate")
            foreach ($replay in @($false, $true)) {
                $name = if ($replay) { "$stem-replay" } else { $stem }
                $file = "$name.json"
                if (Test-Path -LiteralPath $file) { continue }
                $arguments = @('reports/gravity-bot-rebuild/rendered-match.cjs', ('"' + $file + '"'), $seats, $seconds, $rate)
                if ($replay) { $arguments += ('"' + $stem + '.json"') }
                $game = Start-Process -FilePath $electron -ArgumentList $arguments -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput "$name.log" -RedirectStandardError "$name.err"
                $game.WaitForExit()
                if ($game.ExitCode -or !(Test-Path -LiteralPath $file)) { throw "Frame capture failed for $name" }
            }
        }
    }
}
