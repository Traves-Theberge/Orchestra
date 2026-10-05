param(
    [Parameter(Mandatory = $true)][string]$CertificateThumbprint,
    [string]$BinaryPath = (Join-Path $PSScriptRoot '../apps/backend/orchestrad.exe'),
    [string]$SignToolPath,
    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path -LiteralPath $BinaryPath).Path
if ([IO.Path]::GetExtension($binary) -ne '.exe') { throw 'An explicit Windows executable is required.' }
$thumbprint = $CertificateThumbprint.Replace(' ', '')
if ($thumbprint -notmatch '^[0-9a-fA-F]{40}$') { throw 'A 40-character certificate thumbprint is required.' }
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint"
if (!$certificate.HasPrivateKey) { throw 'The selected signing certificate has no accessible private key.' }
if ($certificate.NotAfter -le (Get-Date) -or $certificate.NotBefore -gt (Get-Date)) { throw 'The selected certificate is not currently valid.' }
if ($certificate.Subject -eq $certificate.Issuer) { throw 'A self-signed certificate does not establish Smart App Control trust.' }
if ($certificate.EnhancedKeyUsageList.ObjectId -notcontains '1.3.6.1.5.5.7.3.3') { throw 'The selected certificate is not authorized for code signing.' }
if (!$SignToolPath) {
    $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if (!$command) { throw 'Install SignTool from the Windows SDK or pass -SignToolPath.' }
    $SignToolPath = $command.Source
}
$signTool = (Resolve-Path -LiteralPath $SignToolPath).Path
& $signTool sign /sha1 $thumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $binary
if ($LASTEXITCODE -ne 0) { throw "SignTool signing failed ($LASTEXITCODE)." }
& $signTool verify /pa /all $binary
if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed ($LASTEXITCODE)." }
$signature = Get-AuthenticodeSignature -LiteralPath $binary
if ($signature.Status -ne 'Valid') { throw "Signature verification returned $($signature.Status)." }
if (!$signature.TimeStamperCertificate) { throw 'The signature has no verified timestamp.' }
Write-Output "Signed and verified: $binary"
Write-Output 'Rebuilds replace this signature. Verify actual application startup separately.'
