param(
    [string]$StatePath = (Join-Path $PSScriptRoot '..\data\run-comment\state\coros-sync-state.json'),
    [string]$WatchdogStatePath = (Join-Path $PSScriptRoot '..\data\run-comment\state\coros-sync-watchdog.json'),
    [int]$ThresholdMinutes = 20,
    [switch]$NoNotify
)

$ErrorActionPreference = 'Stop'

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Write-JsonAtomically([string]$Path, [object]$Value) {
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $tempPath = "$Path.tmp.$([Guid]::NewGuid().ToString('N'))"
    $json = $Value | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($tempPath, $json, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tempPath -Destination $Path -Force
}

function Show-StoppedNotification {
    $message = 'COROS FIT sync is stale or repeatedly failing. Check the COROS scheduled task execution log.'
    try {
        Start-Process -FilePath "$env:SystemRoot\System32\msg.exe" -ArgumentList @($env:USERNAME, '/TIME:120', $message) -WindowStyle Hidden
    } catch {
        # The state file still records the alert even when Windows cannot display it.
    }
}

$now = Get-Date
$syncState = Read-JsonFile $StatePath
$watchdogState = Read-JsonFile $WatchdogStatePath
$lastUpdate = $null
$lastSuccess = $null

if ($syncState -and $syncState.updatedAt) {
    try { $lastUpdate = [DateTimeOffset]::Parse([string]$syncState.updatedAt).LocalDateTime } catch {}
}

if ($syncState -and $syncState.lastSuccessfulSyncAt) {
    try { $lastSuccess = [DateTimeOffset]::Parse([string]$syncState.lastSuccessfulSyncAt).LocalDateTime } catch {}
} elseif ($syncState -and -not $syncState.lastRunStatus) {
    # Compatibility with the old state format, before explicit success tracking.
    $lastSuccess = $lastUpdate
} elseif ($syncState -and $syncState.lastAttemptAt) {
    # Allow the first upgraded run to finish; this is a grace period, not a success.
    try { $lastSuccess = [DateTimeOffset]::Parse([string]$syncState.lastAttemptAt).LocalDateTime } catch {}
}

$executionStale = -not $lastUpdate -or (($now - $lastUpdate).TotalMinutes -gt $ThresholdMinutes)
$successStale = -not $lastSuccess -or (($now - $lastSuccess).TotalMinutes -gt $ThresholdMinutes)
$consecutiveFailures = if ($syncState -and $syncState.consecutiveFailures) { [int]$syncState.consecutiveFailures } else { 0 }
$repeatedFailure = $consecutiveFailures -ge 3
$isStale = $executionStale -or $successStale -or $repeatedFailure
$wasAlerted = [bool]($watchdogState -and $watchdogState.alerted)
$shouldNotify = $isStale -and -not $wasAlerted

$nextState = [ordered]@{
    version = 1
    checkedAt = $now.ToString('o')
    lastSyncUpdateAt = if ($lastUpdate) { $lastUpdate.ToString('o') } else { $null }
    lastSuccessfulSyncAt = if ($syncState) { $syncState.lastSuccessfulSyncAt } else { $null }
    executionStale = $executionStale
    successStale = $successStale
    consecutiveFailures = $consecutiveFailures
    repeatedFailure = $repeatedFailure
    thresholdMinutes = $ThresholdMinutes
    stale = $isStale
    alerted = $isStale
    alertedAt = if ($shouldNotify) { $now.ToString('o') } elseif ($isStale -and $watchdogState) { $watchdogState.alertedAt } else { $null }
}

Write-JsonAtomically $WatchdogStatePath $nextState

if ($shouldNotify -and -not $NoNotify) {
    Show-StoppedNotification
}

[pscustomobject]@{
    stale = $isStale
    notified = ($shouldNotify -and -not $NoNotify)
    lastSyncUpdateAt = $nextState.lastSyncUpdateAt
    checkedAt = $nextState.checkedAt
} | ConvertTo-Json -Compress
