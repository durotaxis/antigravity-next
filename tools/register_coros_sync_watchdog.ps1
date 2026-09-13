param(
    [string]$TaskName = 'Codex COROS Sync Watchdog'
)

$ErrorActionPreference = 'Stop'
$launcherPath = Join-Path $PSScriptRoot 'coros_sync_watchdog_hidden.vbs'
$scriptHostPath = "$env:SystemRoot\System32\wscript.exe"
if (-not (Test-Path -LiteralPath $launcherPath) -or -not (Test-Path -LiteralPath $scriptHostPath)) {
    throw 'The hidden COROS watchdog launcher is unavailable.'
}
$arguments = "//B //Nologo `"$launcherPath`""

$action = New-ScheduledTaskAction -Execute $scriptHostPath -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 10) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description 'Warns when COROS synchronization has stopped and Codex must be restarted.' `
    -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
