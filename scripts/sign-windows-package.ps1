param(
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)][string]$CertificateThumbprint,
    [Parameter(Mandatory = $true)][string]$ReportPath,
    [string]$SignToolPath,
    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $ReportPath) { throw 'Choose a new ReportPath; an existing verification report must not be reused.' }
$root = (Resolve-Path -LiteralPath $Directory).Path
$package = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../apps/desktop/package.json') -Raw | ConvertFrom-Json
foreach ($required in "$($package.build.productName).exe",'resources/backend/win32-x64/orchestrad.exe','resources/backend/win32-x64/orchestra.exe') {
    if (!(Test-Path -LiteralPath (Join-Path $root $required) -PathType Leaf)) { throw "Required packaged executable missing: $required" }
}
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
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in '.exe','.dll','.node' })
# Inspect the complete package before modifying any binary. Preserve timestamped
# vendor signatures and reject damaged/untrusted signatures instead of replacing them.
$unsigned = @()
foreach ($file in $files) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -eq 'NotSigned') { $unsigned += $file; continue }
    if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate) {
        throw "Existing signature requires investigation: $($file.FullName) ($($signature.Status))"
    }
}
foreach ($file in $unsigned) {
    & $signTool sign /sha1 $thumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $file.FullName
    if ($LASTEXITCODE -ne 0) { throw "SignTool signing failed for $($file.Name) ($LASTEXITCODE). Do not distribute this partial package." }
    & $signTool verify /pa /all $file.FullName
    if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed for $($file.Name) ($LASTEXITCODE)." }
}
& (Join-Path $PSScriptRoot 'verify-windows-signatures.ps1') -Directory $root -ReportPath $ReportPath
Write-Output "Signed $($unsigned.Count) native files; preserved $($files.Count - $unsigned.Count) existing trusted signatures."
