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

The user selected a certificate provider. The complete portable application now
has `scripts/sign-windows-package.ps1` and a manual `windows-certificate-build`
workflow producing explicitly unsigned artifacts for local token-backed signing.
See [provider setup and commands](../ops/windows-trusted-signing.md). Azure remains
an optional alternative; its attempted run stopped at missing-variable preflight.

### Reference receipt

Inspected T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`,
`.github/workflows/release-desktop.yml`: Windows signing preparation is conditional
on configured publisher/service credentials; absent configuration skips it. Orca
`3284b4c70c901402831bb4ccc5576ea083d2e5ae`,
`.github/workflows/windows-signing-rehearsal.yml`: manually dispatched inner-binary
signing precedes NSIS installer signing and excludes already valid vendor-signed
PE files. This is source inspection, not runtime evidence for either reference.

Orchestra adopts separate build/sign/verify boundaries and vendor preservation.
It deliberately uses a local certificate-backed key for the selected provider,
requires timestamps on preserved files, rejects invalid existing signatures, and
labels unsigned artifacts explicitly. Unlike T3's optional signing preparation,
the trusted-output path fails without signing configuration or verification.
Installer/uninstaller coverage is deferred rather than claimed complete.

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

Certificate-provider adaptation checks: all three signing/verification scripts
parse; both workflow YAML files parse. Actual local negative runs reject malformed
thumbprints and unsigned fixture packages without creating a report, and both
package signing and verification reject an existing report before proceeding.
No fixture binary was executed. Successful signing, timestamp verification and
vendor-signature preservation still need the actual provider key.

The real Windows certificate-build run
[37246383314](https://github.com/Traves-Theberge/Orchestra/actions/runs/37246383314)
passed on main revision `c3c8f0c6c9c3eff22378f6b014aa343e29bc62c3`: clean npm
installation, zero-vulnerability audit, typecheck, backend/CLI compilation,
portable Electron packaging and artifact upload. Its artifact is named
`orchestra-windows-UNSIGNED-c3c8f0c6c9c3eff22378f6b014aa343e29bc62c3`.
This proves Windows build/package output, not signed application startup. The
separate desktop-smoke run `37245545599` remains queued with no job evidence.

Native Windows launch is **not fixed** without a trusted signing setup. No
policy was disabled, altered or bypassed. Backend tests and vulnerability scans
run in the existing Linux Docker validation environment. That is independent
Linux evidence, not a claim about Windows native harnesses or desktop E2E.
