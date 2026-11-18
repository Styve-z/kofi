# Sauvegarde de la base KOFI (Windows PowerShell). Usage : .\scripts\backup-db.ps1
# Lit DATABASE_URL dans .env, écrit backups\kofi-AAAAMMJJ-HHMM.sql et garde les 14 dernières sauvegardes.
# Nécessite mysqldump (installé avec MySQL). Les sauvegardes contiennent des données personnelles : à protéger.
$ErrorActionPreference = 'Stop'
$line = Get-Content (Join-Path $PSScriptRoot '..\.env') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $line) { throw 'DATABASE_URL introuvable dans .env' }
$uri = [uri]($line -replace '^DATABASE_URL=', '')
$user, $pass = $uri.UserInfo.Split(':', 2)
$db = $uri.AbsolutePath.Trim('/')
$dir = Join-Path $PSScriptRoot '..\backups'
New-Item -ItemType Directory -Force $dir | Out-Null
$file = Join-Path $dir ("kofi-{0}.sql" -f (Get-Date -Format 'yyyyMMdd-HHmm'))
$dump = (Get-Command mysqldump -ErrorAction SilentlyContinue).Source
if (-not $dump) { $dump = Get-ChildItem 'C:\Program Files\MySQL' -Recurse -Filter mysqldump.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
if (-not $dump) { throw 'mysqldump introuvable' }
$env:MYSQL_PWD = [uri]::UnescapeDataString($pass)
try {
  & $dump --single-transaction --routines --triggers --no-tablespaces -h $uri.Host -P $(if ($uri.Port -gt 0) { $uri.Port } else { 3306 }) -u ([uri]::UnescapeDataString($user)) $db --result-file=$file
} finally { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
Get-ChildItem $dir -Filter 'kofi-*.sql' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | Remove-Item
Write-Output ("Sauvegarde : {0} ({1:N0} Ko)" -f $file, ((Get-Item $file).Length / 1KB))
