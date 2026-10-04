# Windows App Control launch blocker

The unsigned `apps/backend/orchestrad.exe` was rejected while Electron started
the native sidecar. Code Integrity event 3077 at 2026-10-04 16:29:11 local time
identifies policy `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`. The same policy blocks
some newly built Go test executables and govulncheck. Authenticode reports
`NotSigned`. This session has a medium-integrity token; `CiTool -lp -json`
returned access denied. No accessible code-signing certificate or SignTool
was found. The user confirmed there is no existing signing setup.

Microsoft documents that [Smart App Control has no individual app exception](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions).
The supported publisher remedy is a
[trusted certificate or Artifact Signing](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control).
Creating a self-signed certificate does not meet that trust requirement.

## Prepared signing path

Obtain a code-signing certificate from a trusted provider with an accessible
private key in the current user's Personal certificate store, and install the
Windows SDK SignTool. Then, after building the backend:

```powershell
./scripts/sign-windows-backend.ps1 -CertificateThumbprint '<certificate thumbprint>' -SignToolPath '<absolute signtool.exe path>'
```

The script rejects expired, self-signed and non-code-signing certificates,
signs this specific executable with SHA-256 and a timestamp, and verifies it.
No certificate, secret, policy or trust-store change is made by this repository.
Rebuilding requires signing again. Installer signing alone is insufficient:
the backend sidecar and any blocked native libraries need valid signatures too.
After signing, launch `npm run audit:dev` and independently verify authenticated
API readiness and the actual desktop UI. Signature verification alone does not
prove that Windows admits every component.

## Current verification boundary

Native Windows launch is **not fixed** without a trusted signing setup. No
policy was disabled, altered or bypassed. Backend tests and vulnerability scans
run in the existing Linux Docker validation environment. That is independent
Linux evidence, not a claim about Windows native harnesses or desktop E2E.
