param(
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)][string]$ReportPath
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Directory).Path
$package = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../apps/desktop/package.json') -Raw | ConvertFrom-Json
$application = "$($package.build.productName).exe"
foreach ($required in $application,'resources/backend/win32-x64/orchestrad.exe','resources/backend/win32-x64/orchestra.exe') {
    if (!(Test-Path -LiteralPath (Join-Path $root $required) -PathType Leaf)) { throw "Required packaged executable missing: $required" }
}
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in '.exe','.dll','.node' })
if (!$files.Count) { throw 'No native files found for signature verification.' }
$report = foreach ($file in $files) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -ne 'Valid') { throw "Invalid native signature: $($file.FullName) ($($signature.Status))" }
    if (!$signature.TimeStamperCertificate) { throw "Missing signing timestamp: $($file.FullName)" }
    [pscustomobject]@{
        File = $file.FullName.Substring($root.Length + 1)
        SHA256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        Publisher = $signature.SignerCertificate.Subject
        Certificate = $signature.SignerCertificate.Thumbprint
    }
}
$report | Export-Csv -LiteralPath $ReportPath -NoTypeInformation
Write-Output "Verified $($files.Count) timestamped native signatures. Startup still needs independent Windows verification."
