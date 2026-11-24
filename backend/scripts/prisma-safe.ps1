param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9_-]+$')]
  [string]$Target,

  [Parameter(Mandatory = $true)]
  [string[]]$PrismaArgs,

  [switch]$Retarget,
  [switch]$AllowWrite,
  [switch]$ApprovedDeploySequence
)

$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
Set-Location $backendRoot

function Get-ConfiguredValue([string]$name, [string]$envPath) {
  $processValue = [Environment]::GetEnvironmentVariable($name, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($processValue)) {
    return $processValue.Trim()
  }

  foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match ('^\s*' + [regex]::Escape($name) + '\s*=\s*(.*)$')) {
      $value = $Matches[1].Trim()
      if ($value.StartsWith('"') -and $value.EndsWith('"')) {
        return $value.Substring(1, $value.Length - 2)
      }
      if ($value.StartsWith("'") -and $value.EndsWith("'")) {
        return $value.Substring(1, $value.Length - 2)
      }
      return ($value -replace '\s+#.*$', '').Trim()
    }
  }

  throw "$name is not set in the process environment or backend/.env."
}

function Get-DatabaseTarget([string]$name, [string]$connectionString) {
  try {
    $uri = [Uri]$connectionString
    if ($uri.Scheme -notin @('postgres', 'postgresql') -or [string]::IsNullOrWhiteSpace($uri.Host)) {
      throw 'Unsupported database URL.'
    }
    $database = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($database)) {
      throw 'Database name is missing.'
    }
    return [pscustomobject]@{
      Name = $name
      Uri = $uri
      Host = $uri.Host
      Database = $database
    }
  } catch {
    throw "$name is not a valid PostgreSQL URL. Credentials are intentionally not displayed."
  }
}

if ($PrismaArgs.Count -eq 0) {
  throw 'Provide a Prisma command in -PrismaArgs.'
}

if ($PrismaArgs | Where-Object { $_ -match '(^|-)url(?:=|$)' }) {
  throw 'Datasource URL overrides are not allowed; use -Target and, for a copy, -Retarget.'
}

$envPath = Join-Path $backendRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Missing backend/.env: $envPath"
}

$databaseUrl = Get-ConfiguredValue 'DATABASE_URL' $envPath
$directUrl = Get-ConfiguredValue 'DIRECT_URL' $envPath
$databaseTarget = Get-DatabaseTarget 'DATABASE_URL' $databaseUrl
$directTarget = Get-DatabaseTarget 'DIRECT_URL' $directUrl

Write-Output ("Configured DATABASE_URL: host={0}; database={1}" -f $databaseTarget.Host, $databaseTarget.Database)
Write-Output ("Configured DIRECT_URL:   host={0}; database={1}" -f $directTarget.Host, $directTarget.Database)

if ($databaseTarget.Database -ne $directTarget.Database) {
  throw 'DATABASE_URL and DIRECT_URL name different databases; refusing to run Prisma.'
}

if ($databaseTarget.Database -ne $Target -and -not $Retarget) {
  throw "Configured database does not match -Target '$Target'. Use -Retarget only for an explicitly approved test copy."
}

if ($Retarget) {
  foreach ($configuredTarget in @($databaseTarget, $directTarget)) {
    $builder = [UriBuilder]$configuredTarget.Uri
    $builder.Path = '/' + $Target
    if ($configuredTarget.Name -eq 'DATABASE_URL') {
      $databaseUrl = $builder.Uri.AbsoluteUri
    } else {
      $directUrl = $builder.Uri.AbsoluteUri
    }
  }
}

$effectiveDatabaseTarget = Get-DatabaseTarget 'DATABASE_URL' $databaseUrl
$effectiveDirectTarget = Get-DatabaseTarget 'DIRECT_URL' $directUrl
Write-Output ("Prisma DATABASE_URL target: host={0}; database={1}" -f $effectiveDatabaseTarget.Host, $effectiveDatabaseTarget.Database)
Write-Output ("Prisma DIRECT_URL target:   host={0}; database={1}" -f $effectiveDirectTarget.Host, $effectiveDirectTarget.Database)

if ($effectiveDatabaseTarget.Database -ne $Target -or $effectiveDirectTarget.Database -ne $Target) {
  throw "Both effective Prisma URLs must match -Target '$Target'."
}

$argumentsText = $PrismaArgs -join ' '
$normalizedArguments = $argumentsText.ToLowerInvariant()
$isMigrationDeploy = $normalizedArguments -match '(^|\s)migrate\s+deploy($|\s)'
$isForbiddenMutation = $normalizedArguments -match '(^|\s)(db\s+push|db\s+execute|migrate\s+(dev|reset))($|\s)'
$migrationMatch = [regex]::Match($normalizedArguments, '(^|\s)migrate\s+([a-z]+)(\s|$)')
$unsupportedMigration = $migrationMatch.Success -and $migrationMatch.Groups[2].Value -notin @('deploy', 'status', 'diff', 'dev', 'reset')
$isWriteCommand = $isMigrationDeploy -or $isForbiddenMutation -or $unsupportedMigration -or
  $normalizedArguments -match '(^|\s)(generate|format|db\s+(seed|pull))($|\s)'

if ($isForbiddenMutation) {
  throw 'db push, db execute, migrate dev, and migrate reset are blocked by this wrapper. Test migrations with psql and prisma migrate diff.'
}
if ($unsupportedMigration) {
  throw 'Unsupported Prisma migration command. This wrapper permits only read-only migrate status/diff and deploy in the approved sequence.'
}
if ($isWriteCommand -and -not $AllowWrite) {
  throw 'This Prisma command can write; pass -AllowWrite only for an explicitly approved operation.'
}
if ($isMigrationDeploy -and -not $ApprovedDeploySequence) {
  throw 'migrate deploy is allowed only in the approved stop-and-start deploy sequence; pass -ApprovedDeploySequence after that approval.'
}
if ($ApprovedDeploySequence -and -not $isMigrationDeploy) {
  throw '-ApprovedDeploySequence applies only to prisma migrate deploy.'
}
if ($normalizedArguments -match '(^|\s)generate($|\s)') {
  $listeners = Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue
  if ($listeners) {
    throw 'Refusing prisma generate while a backend listener is active on port 5001.'
  }
}

$env:DATABASE_URL = $databaseUrl
$env:DIRECT_URL = $directUrl
& npx prisma @PrismaArgs
exit $LASTEXITCODE
