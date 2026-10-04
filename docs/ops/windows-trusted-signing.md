# Trusted Windows signing

The unsigned backend is blocked by Smart App Control. The repository now has
a manual `windows-trusted-signing` workflow that builds and signs a portable
Windows application, its backend/CLI, and native DLL/Node libraries. It runs only
on main, uses pinned actions and Azure OIDC, requires configuration before doing
build work, and uploads only after signature/timestamp verification. It does not
publish a release or claim native startup verification. No signing run has been
completed yet: there is no configured trusted signing account.

The workflow YAML and PowerShell script parse successfully. Actual verification
checks reject a missing executable and unsigned fixture files without emitting
a success report. Signing, timestamp verification of a signed build and native
application startup remain unverified until the publisher setup is complete.

## Account setup required from the publisher

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

## Verification and local development

Run the manual workflow on main after configuration. Download the resulting
portable artifact and extract it. Launch the application and verify authenticated
API readiness, workspace access and native chat independently. Signature checks
alone do not prove that Windows admits every component.

For local dev, the signed artifact's
`resources/backend/win32-x64/orchestrad.exe` can be selected explicitly:

```powershell
$env:ORCHESTRA_BACKEND_BIN = '<absolute path to the verified signed backend>'
cd apps/desktop
npm run audit:dev
```

This selects the same signed backend built from main; it is not a policy bypass.
Rebuilding changes the binary and removes its signature. Build new signed
artifacts after backend changes. Preserve the existing audit profile and database;
do not replace them with data shipped in a build. Locally issued certificate
signing is also supported by `scripts/sign-windows-backend.ps1` once a trusted
certificate and Windows SDK SignTool are available.

The manual workflow currently produces a portable directory, not an installer.
The older release workflow remains separate and must not be described as signed.
