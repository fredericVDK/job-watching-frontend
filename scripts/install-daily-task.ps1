# Registreert een dagelijkse Windows-taak "JobWatcher" die de scraper draait.
# Gebruik:  dubbelklik scripts\install-daily-task.cmd
#      of:  powershell -ExecutionPolicy Bypass -File scripts\install-daily-task.ps1 -Time 08:00
param([string]$Time = "08:00")
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js niet gevonden. Installeer Node.js 22 LTS via https://nodejs.org" }

$version = (& $node --version).TrimStart('v').Split('.')
if ([int]$version[0] -lt 22 -or ([int]$version[0] -eq 22 -and [int]$version[1] -lt 13)) {
  throw "JobWatcher heeft Node.js 22.13 of nieuwer nodig (gevonden: $(& $node --version))."
}

$action = New-ScheduledTaskAction -Execute $node `
  -Argument "--no-warnings=ExperimentalWarning `"$root\scraper\run.mjs`"" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
# StartWhenAvailable: stond je pc uit om $Time, dan loopt de taak zodra hij weer aan staat.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName 'JobWatcher' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Zoekt dagelijks nieuwe vacatures die bij je CV passen (JobWatcher).' -Force | Out-Null

Write-Host ""
Write-Host "OK - taak 'JobWatcher' draait elke dag om $Time." -ForegroundColor Green
Write-Host "Logboek: $root\logs\scraper.log"
Write-Host "Nu meteen testen?  Start-ScheduledTask -TaskName JobWatcher"
