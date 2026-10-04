# Security cleanup after ADE integration

PR #173 merged to main as `b564a35`; its five correctness review repairs are
committed as `60551d3`. This package replaces the open dependency updates with
coherent, newer secure versions instead of mixing incompatible module versions.

## Dependency changes

The initial npm audit reported 51 affected packages: four critical, 32 high,
seven moderate and eight low. Compatible patch updates removed most findings.
Transformers 4.3.0 replaces the vulnerable Sharp dependency; the ANSI renderer
uses a scoped Linkify 6.1 override rather than the audit tool's downgrade.
DOMPurify 3.4.16 is shared by Monaco and Mermaid. The lockfile contains Electron
41.10.7, Vitest 4.1.11 and newer AI SDK patches. TypeScript 6.0.3 and its compatible
ESLint integration are paired with relative path aliases, replacing baseUrl.

Go modules and workspace now use Go 1.26.8. Chi, x/crypto, x/net, x/sys and x/text
are updated beyond the scan's patched versions. Kubernetes api/apimachinery/
client-go move together to 0.36.1. SQLite and TOML are updated. CI defaults to
Node 24 and runs npm audit plus Linux/Windows backend symbol vulnerability scans
and a Linux TUI scan. Existing desktop smoke CI now runs the isolation, ANSI,
managed backend and evidence-gate Node tests.

Included dependency PR changes: #75, #125, #128, #129, #130, #131, #133, #159,
#161, #162, #163, #164, #170, #171 and #172. Docker metadata/build/login and GitHub
script changes preserve pinned action SHAs. Each PR is to be closed only after
the equivalent or newer changes reach main.

## Rate-limit security fix and references

Clients could create fresh buckets by forging X-Forwarded-For, or changing
source port. Rate limits now use the actual socket peer, normalize IPv4/IPv6,
and ignore untrusted forwarding headers. The router no longer rewrites that
peer with Chi RealIP. Trusted proxy support is not claimed.

Inspected T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`, server `auth/http.ts`
and `http.ts`: authenticated credentials/scope and loopback checks establish
authority. Inspected Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`,
`daemon-server.ts` and `daemon-endpoint-lifecycle.ts`: owned local sockets,
tokens and restrictive modes protect daemon authority. Neither inspected
boundary establishes an equivalent proxy-aware rate limiter. Orchestra's
direct-peer policy is an independent adaptation; no source was copied and
neither reference application was run.

Regression tests send forged headers through a real loopback HTTP router,
verify source-port changes share a bucket, and cover mapped IPv4 and IPv6.
The auth matrix now isolates transport peers instead of supplying fake forwarded
headers. The first broad race run exposed this test assumption; protections
were retained and the test isolation was repaired.

## Verified results and limits

- Clean npm install and `npm audit --audit-level=low`: zero vulnerabilities.
- Typecheck, production build and 85 Vitest files: 571 passed, two skipped.
- Lint: zero errors; existing warnings remain.
- Twenty Node tests pass, including the actual updated ANSI linkifier.
- Native targeted authentication/rate-limit regressions pass.
- Full Linux backend `go test -race ./...` passes after the auth matrix repair.
- Linux and Windows backend govulncheck symbol scans exit successfully with no
  imported/called vulnerability. Linux TUI scan has no findings.

An upstream x/crypto/openpgp advisory, GO-2026-5932, remains module-only with no
patched release reported. Neither Go module imports openpgp; scans show no
affected package/function trace. This is unused vulnerable code in a required
module, not a patched advisory. GitHub Dependabot alerts were enabled and must
be reconciled against the updated main dependency graph, without blanket
dismissal. This audit cannot guarantee absence of unknown vulnerabilities.

Native Windows execution remains blocked by Smart App Control; see
[the signing preparation and exact blocker](windows-app-control-2026-10-04.md).
Whisper inference and signed-in provider turns were not run as security tests.
Build/unit evidence does not establish full desktop E2E reliability.
