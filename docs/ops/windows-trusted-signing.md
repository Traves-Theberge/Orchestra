# Trusted Windows signing

The selected path is a certificate provider, rather than an Azure subscription.
The repository supports local Windows SDK SignTool signing with a CA-issued
certificate whose hardware-backed private key is accessible through the current
user's Personal certificate store. No certificate has been issued or purchased
in this session; native Windows launch is still blocked pending issuance.

## Certificate and key storage

[SSL.com individual code signing](https://www.ssl.com/products/software-integrity/code-signing/iv/)
is available without a registered business and displays the verified personal
name. The current page lists $129/year plus $379 for its physical token, or a
separate eSigner subscription for cloud signing. Confirm checkout currency,
Canadian delivery, taxes and total before ordering. A company publisher instead
needs organization validation. The provider requires identity verification;
complete it directly with the provider, not through chat.

Install the provider's token driver/key provider and public certificate using its
instructions. The private key stays on the token; do not export it or commit a
PFX, PIN, password or recovery material. Install Windows SDK SignTool separately.
A provider cloud service needs its own supported integration; this local script
does not claim to implement eSigner API authentication. Hardware tokens cannot be
accessed by GitHub-hosted runners.

## Build, sign and verify

Run the manual `windows-certificate-build` workflow on main. It builds the desktop,
backend and task CLI without any signing account. Its artifact explicitly includes
`UNSIGNED` in its name and must not be distributed as a trusted release. Extract
it locally, connect the token and sign the unpacked application:

```powershell
./scripts/sign-windows-package.ps1 `
  -Directory '<absolute path to extracted win-unpacked>' `
  -CertificateThumbprint '<40-character certificate thumbprint>' `
  -SignToolPath '<absolute path to signtool.exe>' `
  -ReportPath '<new signatures.csv path>'
```

The script validates the certificate and packaged desktop/backend/CLI layout,
inspects all EXE/DLL/Node binaries before signing, preserves existing valid
and timestamped vendor signatures, and rejects damaged or untrusted signatures.
It signs unsigned files with SHA-256 and an RFC3161 timestamp, then verifies
signatures and writes a hash/publisher report. Do not distribute a partial package
if signing fails. Use a new report path for each run; stale reports are rejected.
Token PIN prompts are handled by the provider's driver, not stored by this script.

For a rebuilt development backend alone, use `sign-windows-backend.ps1` with the
same certificate thumbprint and SignTool path. Rebuilding removes its signature.
To use the signed package's backend for the existing audit profile:

```powershell
$env:ORCHESTRA_BACKEND_BIN = '<signed package>/resources/backend/win32-x64/orchestrad.exe'
cd apps/desktop
npm run audit:dev
```

Preserve the existing audit database and profile. Verify actual Windows startup,
authenticated API readiness, workspace access and native chat independently after
issuance; signatures alone do not prove these behaviors. The portable build has
no installer. Installer and uninstaller signing need a separate verified packaging
stage before release, and the existing release workflow is not claimed as signed.

## Verification boundary

PowerShell/YAML parsing and rejection of missing files, malformed certificate
identity, unsigned artifacts and stale report paths can be checked without a key.
A successful certificate-backed signing run, vendor preservation and Windows
admission remain unverified until the certificate is installed. The earlier Azure
workflow preflight failed as intended on missing configuration before authentication
or signing; no Azure account or billable service was created.

## Optional Azure alternative (not the selected path)

Follow Microsoft's [Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart).
An Azure subscription, identity validation and a **PublicTrust** certificate
profile are required. Canada-based individual developers are eligible, but
identity verification must be completed personally in Azure. Do not send identity
documents or account passwords through chat. A PrivateTrust or PublicTrustTest
profile is not the production public-trust remedy.

The service [charges a monthly fee beginning when the account is created](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/).
Review the actual subscription/currency price before provisioning. This work has
not created a billable account, registered a payment method or changed Windows
protection.

## Main-only access

Create an Entra application with a GitHub federated credential:

- Issuer: `https://token.actions.githubusercontent.com`
- Audience: `api://AzureADTokenExchange`
- Subject: `repo:Traves-Theberge/Orchestra:ref:refs/heads/main`

Assign **Artifact Signing Certificate Profile Signer** at this certificate
profile's resource scope. Avoid subscription-wide signing authority and client
secrets. Microsoft's [signing action](https://github.com/Azure/artifact-signing-action)
supports authenticated Azure CLI credentials established through OIDC.

Configure these repository Actions variables (identifiers, not private keys):

| Variable | Value |
| --- | --- |
| `AZURE_SIGNING_CLIENT_ID` | Entra application client ID |
| `AZURE_SIGNING_TENANT_ID` | Entra tenant ID |
| `AZURE_SIGNING_SUBSCRIPTION_ID` | Subscription ID |
| `AZURE_SIGNING_ENDPOINT` | Account region endpoint from Azure |
| `AZURE_SIGNING_ACCOUNT` | Signing account name |
| `AZURE_SIGNING_PROFILE` | Validated PublicTrust certificate profile name |
