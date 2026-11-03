$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Set-Location (Join-Path $PSScriptRoot '../..')
if (!(Test-Path -LiteralPath 'data/lan/api.env')) { throw 'Prepare data/lan/api.env first.' }
$employeeId = Read-Host 'First administrator employee ID (preserve leading zeros)'
$displayName = Read-Host 'Administrator display name'
$securePassword = Read-Host 'Temporary password (4-128 characters)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
 $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
 $payload = @{ employeeId = $employeeId; name = $displayName; password = $plain } | ConvertTo-Json -Compress
 $payload | node --env-file=data/lan/api.env apps/api/dist/bootstrap-local.js
 if ($LASTEXITCODE -ne 0) { throw 'Bootstrap failed; no default account was created.' }
} finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $plain = $null; $payload = $null }
