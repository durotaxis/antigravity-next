param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{1,3}(?:\.\d{1,3}){3}$')]
    [string]$ServerIp
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$httpsDirectory = Join-Path $projectRoot '.https'
$envPath = Join-Path $projectRoot '.env'

function Get-DotEnvValue {
    param([Parameter(Mandatory = $true)][string]$Name)

    $prefix = "$Name="
    $line = Get-Content -LiteralPath $envPath |
        Where-Object { $_.StartsWith($prefix, [System.StringComparison]::Ordinal) } |
        Select-Object -First 1
    if (-not $line) {
        throw "$Name is not configured in .env."
    }

    $value = $line.Substring($prefix.Length).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    if (-not $value) {
        throw "$Name is empty in .env."
    }
    return $value
}

New-Item -ItemType Directory -Path $httpsDirectory -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDirectory = Join-Path $httpsDirectory "backup-$timestamp"
$existingFiles = @(
    'local-https.cer',
    'local-https.pfx',
    'local-root-ca.cer',
    'local-root-ca.pfx'
)
$filesToBackUp = $existingFiles |
    ForEach-Object { Join-Path $httpsDirectory $_ } |
    Where-Object { Test-Path -LiteralPath $_ }

if ($filesToBackUp.Count -gt 0) {
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    foreach ($file in $filesToBackUp) {
        Copy-Item -LiteralPath $file -Destination $backupDirectory
    }
}

$securePassword = ConvertTo-SecureString (Get-DotEnvValue -Name 'HTTPS_PASSPHRASE') -AsPlainText -Force
$rootSubject = 'CN=AntiGravity Local Root CA'
$root = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $rootSubject `
    -FriendlyName 'AntiGravity Local Root CA' `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyUsageProperty Sign `
    -KeyUsage CertSign, CRLSign, DigitalSignature `
    -TextExtension @('2.5.29.19={critical}{text}ca=true&pathlength=1') `
    -NotAfter (Get-Date).AddYears(10) `
    -CertStoreLocation 'Cert:\CurrentUser\My'

$server = New-SelfSignedCertificate `
    -Type Custom `
    -Subject "CN=$ServerIp" `
    -FriendlyName "AntiGravity HTTPS $ServerIp" `
    -Signer $root `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -TextExtension @(
        '2.5.29.19={critical}{text}ca=false',
        '2.5.29.37={text}1.3.6.1.5.5.7.3.1',
        "2.5.29.17={text}IPAddress=$ServerIp&DNS=localhost"
    ) `
    -NotAfter (Get-Date).AddYears(3) `
    -CertStoreLocation 'Cert:\CurrentUser\My'

$rootCerPath = Join-Path $httpsDirectory 'local-root-ca.cer'
$rootPfxPath = Join-Path $httpsDirectory 'local-root-ca.pfx'
$serverCerPath = Join-Path $httpsDirectory 'local-https.cer'
$serverPfxPath = Join-Path $httpsDirectory 'local-https.pfx'

Export-Certificate -Cert $root -FilePath $rootCerPath -Type CERT -Force | Out-Null
Export-PfxCertificate -Cert $root -FilePath $rootPfxPath -Password $securePassword -ChainOption EndEntityCertOnly -Force | Out-Null
Export-Certificate -Cert $server -FilePath $serverCerPath -Type CERT -Force | Out-Null
Export-PfxCertificate -Cert $server -FilePath $serverPfxPath -Password $securePassword -ChainOption EndEntityCertOnly -Force | Out-Null

[pscustomobject]@{
    RootCertificate = $rootCerPath
    ServerCertificate = $serverCerPath
    ServerPfx = $serverPfxPath
    ServerIp = $ServerIp
    RootExpires = $root.NotAfter
    ServerExpires = $server.NotAfter
    BackupDirectory = if ($filesToBackUp.Count -gt 0) { $backupDirectory } else { $null }
}
