# النسخ الاحتياطي لقاعدة بيانات الفنان ERP
# يقرأ DATABASE_URL من apps/api/.env، يأخذ نسخة pg_dump بصيغة مضغوطة (custom)،
# ويحتفظ بآخر 30 نسخة في مجلد backups/ (خارج git).
#
# تشغيل يدوي:   powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
# الاستعادة:    pg_restore -d alfannan -c backups\alfannan-YYYYMMDD-HHmmss.dump

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$backupDir = Join-Path $root 'backups'
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory $backupDir | Out-Null }

# parse DATABASE_URL: postgresql://user:pass@host:port/db?schema=public
$envFile = Get-Content (Join-Path $root 'apps\api\.env') -Raw
if ($envFile -notmatch 'DATABASE_URL="postgresql://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?"]+)') {
    throw 'DATABASE_URL not found or not in the expected format in apps/api/.env'
}
$dbUser = $Matches[1]; $dbPass = $Matches[2]; $dbHost = $Matches[3]; $dbPort = $Matches[4]; $dbName = $Matches[5]

# locate pg_dump (newest installed PostgreSQL)
$pgDump = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName | Select-Object -Last 1
if (-not $pgDump) { $pgDump = (Get-Command pg_dump -ErrorAction Stop).Source } else { $pgDump = $pgDump.FullName }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outFile = Join-Path $backupDir "$dbName-$stamp.dump"

$env:PGPASSWORD = $dbPass
try {
    & $pgDump -h $dbHost -p $dbPort -U $dbUser -d $dbName -F c -f $outFile
    if ($LASTEXITCODE -ne 0) { throw "pg_dump exited with code $LASTEXITCODE" }
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

$size = [math]::Round((Get-Item $outFile).Length / 1KB, 1)
Write-Output "backup OK: $outFile ($size KB)"

# rotation: keep the newest 30
Get-ChildItem $backupDir -Filter "$dbName-*.dump" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 30 |
    Remove-Item -Force -Confirm:$false
