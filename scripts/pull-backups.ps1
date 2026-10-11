<#
.SYNOPSIS
  Pulls the server's database dumps to this machine (off-site copy).

.DESCRIPTION
  The server's `backup` container writes a compressed pg_dump to /opt/alfannan/backups every day
  (it keeps the last 30). Those files live on the same machine as the database, so a disk failure
  or a lost server would take the backups with it. This script copies any dump that is not here yet
  to another machine, verifies it, keeps the newest N, and logs what it did.

  Runs unattended (Task Scheduler) - see register-backup-task.ps1. Needs key-based SSH to the
  server (BatchMode, no password prompt): see docs/BACKUP-RESTORE.md.

.PARAMETER Remote      user@host of the server                       (default root@100.64.92.110)
.PARAMETER RemoteDir   backups directory on the server                (default /opt/alfannan/backups)
.PARAMETER Destination where the copies are kept on this machine      (default D:\backups\alfannan)
.PARAMETER Keep        how many dumps to keep locally                 (default 60)
.PARAMETER MaxAgeHours alarm when the newest server dump is older     (default 36)
.PARAMETER SourceDir   copy from a local folder instead of the server (testing the script itself)

.NOTES
  Exit codes: 0 ok | 1 error (nothing could be copied / verification failed) | 2 stale backups on the server
#>
[CmdletBinding()]
param(
  [string]$Remote = 'root@100.64.92.110',
  [string]$RemoteDir = '/opt/alfannan/backups',
  [string]$Destination = 'D:\backups\alfannan',
  [int]$Keep = 60,
  [int]$MaxAgeHours = 36,
  [string]$SourceDir = ''
)

$ErrorActionPreference = 'Stop'
$script:exitCode = 0

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$logFile = Join-Path $Destination 'pull-backups.log'

function Write-Log([string]$message) {
  $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $message
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

# alfannan-20261011-032937.dump  ->  DateTime (the file name carries the time, not the copy time)
function Get-DumpTime([string]$name) {
  if ($name -match '^alfannan-(\d{8})-(\d{6})\.dump$') {
    return [datetime]::ParseExact($Matches[1] + $Matches[2], 'yyyyMMddHHmmss', $null)
  }
  return $null
}

# A dump is usable if it is non-empty and pg_restore can read its table of contents.
function Test-Dump([string]$path) {
  $item = Get-Item $path
  if ($item.Length -lt 1024) { return "too small ($($item.Length) bytes)" }
  $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if ($wsl) {
    $drive = $path.Substring(0, 1).ToLower()
    $rest = $path.Substring(2).Replace('\', '/')
    $wslPath = "/mnt/$drive$rest"
    $out = & wsl.exe -e pg_restore --list $wslPath 2>&1
    if ($LASTEXITCODE -ne 0) { return "pg_restore cannot read it: $($out | Select-Object -First 1)" }
  }
  return $null
}

try {
  Write-Log "=== backup pull started (source: $(if ($SourceDir) { $SourceDir } else { "$Remote`:$RemoteDir" })) ==="

  # 1. what does the server have?
  $remoteNames = @()
  if ($SourceDir) {
    $remoteNames = @(Get-ChildItem -Path $SourceDir -Filter 'alfannan-*.dump' | Select-Object -ExpandProperty Name)
  } else {
    $listing = & ssh.exe -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new $Remote "ls -1 $RemoteDir"
    if ($LASTEXITCODE -ne 0) { throw "ssh failed (exit $LASTEXITCODE) - is key-based login set up? See docs/BACKUP-RESTORE.md" }
    $remoteNames = @($listing | Where-Object { $_ -match '^alfannan-\d{8}-\d{6}\.dump$' })
  }
  if ($remoteNames.Count -eq 0) { throw 'no dumps found at the source' }

  $newest = $remoteNames | Sort-Object | Select-Object -Last 1
  $newestTime = Get-DumpTime $newest
  if ($newestTime) {
    $ageHours = [math]::Round(((Get-Date) - $newestTime).TotalHours, 1)
    Write-Log "newest dump at the source: $newest ($ageHours h old)"
    if ($ageHours -gt $MaxAgeHours) {
      Write-Log "WARNING: the server has not produced a backup for $ageHours h (limit $MaxAgeHours h) - check the backup container"
      $script:exitCode = 2
    }
  }

  # 2. copy what is missing - one bad file must not stop the others
  $copied = 0
  foreach ($name in ($remoteNames | Sort-Object)) {
    $target = Join-Path $Destination $name
    if (Test-Path $target) { continue }
    $partial = "$target.part"
    try {
      if ($SourceDir) {
        Copy-Item -Path (Join-Path $SourceDir $name) -Destination $partial -Force
      } else {
        & scp.exe -o BatchMode=yes -o ConnectTimeout=20 -q "${Remote}:${RemoteDir}/$name" $partial
        if ($LASTEXITCODE -ne 0) { throw "scp failed (exit $LASTEXITCODE)" }
      }
      $problem = Test-Dump $partial
      if ($problem) { throw "verification failed: $problem" }
      Move-Item -Path $partial -Destination $target
      $size = [math]::Round((Get-Item $target).Length / 1KB)
      Write-Log "copied $name ($size KB, verified)"
      $copied++
    }
    catch {
      if (Test-Path $partial) { Remove-Item $partial -Force }
      Write-Log "ERROR: $name - $($_.Exception.Message)"
      $script:exitCode = 1
    }
  }
  if ($copied -eq 0) { Write-Log 'already up to date' }

  # 3. retention: keep the newest $Keep
  $local = @(Get-ChildItem -Path $Destination -Filter 'alfannan-*.dump' | Sort-Object Name)
  if ($local.Count -gt $Keep) {
    $remove = $local | Select-Object -First ($local.Count - $Keep)
    foreach ($f in $remove) {
      Remove-Item $f.FullName -Force
      Write-Log "retention: removed $($f.Name)"
    }
  }
  $localNow = @(Get-ChildItem -Path $Destination -Filter 'alfannan-*.dump')
  $totalMb = [math]::Round((($localNow | Measure-Object -Property Length -Sum).Sum) / 1MB, 1)
  Write-Log "local copies: $($localNow.Count) files, $totalMb MB"
}
catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  $script:exitCode = 1
}

exit $script:exitCode
