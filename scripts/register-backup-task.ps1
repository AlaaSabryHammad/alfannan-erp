<#
.SYNOPSIS
  Registers a daily Windows Scheduled Task that runs pull-backups.ps1.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1 -At 04:15 -Destination E:\alfannan-backups
#>
[CmdletBinding()]
param(
  [string]$At = '03:45',
  [string]$Destination = 'D:\backups\alfannan',
  [string]$Remote = 'root@100.64.92.110',
  [string]$TaskName = 'Alfannan-Pull-Backups'
)

$script = Join-Path $PSScriptRoot 'pull-backups.ps1'
if (-not (Test-Path $script)) { throw "pull-backups.ps1 not found next to this script" }

$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Remote `"$Remote`" -Destination `"$Destination`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At $At
# if the PC was off at that time, run it as soon as it is back; retry a few times when the network is down
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 15) -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Pulls the Alfannan server database dumps to this machine (off-site copy)' -Force | Out-Null

Write-Host "Registered '$TaskName' - daily at $At, copies to $Destination"
Write-Host "Run it now to test:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Log:                 $(Join-Path $Destination 'pull-backups.log')"
