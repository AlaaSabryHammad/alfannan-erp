<#
.SYNOPSIS
  Pulls the server's backups (database dumps + uploaded images) to this machine (off-site copy).

.DESCRIPTION
  The server's `backup` container writes, every day, to /opt/alfannan/backups:
      alfannan-YYYYMMDD-HHMMSS.dump   compressed pg_dump of the database
      uploads-YYYYMMDD-HHMMSS.tgz     archive of the uploaded product images (not part of pg_dump)
  and keeps the last 30 of each. Those files live on the same machine as the database, so a disk
  failure or a lost server would take the backups with it. This script copies whatever is not here
  yet to another machine, verifies it, keeps the newest N of each kind, and logs what it did.

  Runs unattended (Task Scheduler) - see register-backup-task.ps1. Needs key-based SSH to the
  server (BatchMode, no password prompt): see docs/BACKUP-RESTORE.md.

.PARAMETER Remote      user@host of the server                       (default root@145.223.82.253)
.PARAMETER RemoteDir   backups directory on the server                (default /opt/alfannan/backups)
.PARAMETER Destination where the copies are kept on this machine      (default D:\backups\alfannan-prod)
.PARAMETER Keep        how many files of each kind to keep locally    (default 60)
.PARAMETER MaxAgeHours alarm when the newest server backup is older   (default 36)
.PARAMETER SourceDir   copy from a local folder instead of the server (testing the script itself)

.NOTES
  Exit codes: 0 ok | 1 error (a file could not be copied / verified) | 2 stale backups on the server
#>
[CmdletBinding()]
param(
  [string]$Remote = 'root@145.223.82.253',
  [string]$RemoteDir = '/opt/alfannan/backups',
  [string]$Destination = 'D:\backups\alfannan-prod',
  [int]$Keep = 60,
  [int]$MaxAgeHours = 36,
  [string]$SourceDir = ''
)

$ErrorActionPreference = 'Stop'
$script:exitCode = 0

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$logFile = Join-Path $Destination 'pull-backups.log'

# the two kinds of backup this script knows
$kinds = @(
  @{ Label = 'database'; Prefix = 'alfannan'; Ext = 'dump' },
  @{ Label = 'uploads';  Prefix = 'uploads';  Ext = 'tgz'  }
)

function Write-Log([string]$message) {
  $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $message
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

# alfannan-20261011-032937.dump  ->  DateTime (the file name carries the time, not the copy time)
function Get-BackupTime([string]$name) {
  if ($name -match '^[a-z]+-(\d{8})-(\d{6})\.(dump|tgz)$') {
    return [datetime]::ParseExact($Matches[1] + $Matches[2], 'yyyyMMddHHmmss', $null)
  }
  return $null
}

function ConvertTo-WslPath([string]$path) {
  $drive = $path.Substring(0, 1).ToLower()
  return ('/mnt/' + $drive) + $path.Substring(2).Replace('\', '/')
}

# A backup is usable if it is non-empty and its container format can be read.
function Test-Backup([string]$path, [string]$ext) {
  $item = Get-Item $path
  if ($ext -eq 'dump') {
    if ($item.Length -lt 1024) { return "too small ($($item.Length) bytes)" }
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if ($wsl) {
      $out = & wsl.exe -e pg_restore --list (ConvertTo-WslPath $path) 2>&1
      if ($LASTEXITCODE -ne 0) { return "pg_restore cannot read it: $($out | Select-Object -First 1)" }
    }
  } else {
    # an archive of an empty folder is legitimately tiny, but never zero
    if ($item.Length -lt 20) { return "too small ($($item.Length) bytes)" }
    $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
    if ($tar) {
      $null = & tar.exe -tzf $path 2>&1
      if ($LASTEXITCODE -ne 0) { return 'archive is corrupt (tar cannot list it)' }
    }
  }
  return $null
}

try {
  $sourceLabel = if ($SourceDir) { $SourceDir } else { "${Remote}:${RemoteDir}" }
  Write-Log "=== backup pull started (source: $sourceLabel) ==="

  # 1. what does the server have?
  $remoteNames = @()
  if ($SourceDir) {
    $remoteNames = @(Get-ChildItem -Path $SourceDir -File | Select-Object -ExpandProperty Name)
  } else {
    $listing = & ssh.exe -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new $Remote "ls -1 $RemoteDir"
    if ($LASTEXITCODE -ne 0) { throw "ssh failed (exit $LASTEXITCODE) - is key-based login set up? See docs/BACKUP-RESTORE.md" }
    $remoteNames = @($listing)
  }

  foreach ($kind in $kinds) {
    $pattern = '^' + $kind.Prefix + '-\d{8}-\d{6}\.' + $kind.Ext + '$'
    $names = @($remoteNames | Where-Object { $_ -match $pattern } | Sort-Object)
    $label = $kind.Label

    if ($names.Count -eq 0) {
      # the database is mandatory; image archives only exist once the server runs the new backup service
      if ($label -eq 'database') { throw 'no database dumps found at the source' }
      Write-Log "[$label] none at the source yet"
      continue
    }

    # freshness
    $newest = $names | Select-Object -Last 1
    $newestTime = Get-BackupTime $newest
    if ($newestTime) {
      $ageHours = [math]::Round(((Get-Date) - $newestTime).TotalHours, 1)
      Write-Log "[$label] newest at the source: $newest ($ageHours h old)"
      if ($ageHours -gt $MaxAgeHours) {
        Write-Log "WARNING: [$label] the server has not produced a backup for $ageHours h (limit $MaxAgeHours h) - check the backup container"
        if ($script:exitCode -lt 2) { $script:exitCode = 2 }
      }
    }

    # 2. copy what is missing - one bad file must not stop the others.
    #    Only the newest $Keep are worth copying (older ones would be deleted by retention right away).
    $copied = 0
    foreach ($name in ($names | Select-Object -Last $Keep)) {
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
        $problem = Test-Backup $partial $kind.Ext
        if ($problem) { throw "verification failed: $problem" }
        Move-Item -Path $partial -Destination $target
        $size = [math]::Round((Get-Item $target).Length / 1KB)
        Write-Log "[$label] copied $name ($size KB, verified)"
        $copied++
      }
      catch {
        if (Test-Path $partial) { Remove-Item $partial -Force }
        Write-Log "ERROR: [$label] $name - $($_.Exception.Message)"
        $script:exitCode = 1
      }
    }
    if ($copied -eq 0) { Write-Log "[$label] already up to date" }

    # 3. retention: keep the newest $Keep of this kind
    $localFilter = $kind.Prefix + '-*.' + $kind.Ext
    $local = @(Get-ChildItem -Path $Destination -Filter $localFilter | Sort-Object Name)
    if ($local.Count -gt $Keep) {
      $remove = $local | Select-Object -First ($local.Count - $Keep)
      foreach ($f in $remove) {
        Remove-Item $f.FullName -Force
        Write-Log "[$label] retention: removed $($f.Name)"
      }
    }
    $localNow = @(Get-ChildItem -Path $Destination -Filter $localFilter)
    $totalMb = [math]::Round((($localNow | Measure-Object -Property Length -Sum).Sum) / 1MB, 1)
    Write-Log "[$label] local copies: $($localNow.Count) files, $totalMb MB"
  }
}
catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  $script:exitCode = 1
}

exit $script:exitCode
