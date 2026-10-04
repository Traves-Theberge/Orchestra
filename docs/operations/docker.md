# Backend containers and the Linux verification lane

`ops/docker/Dockerfile.backend` has separate `test`, `build`, and final `runtime` targets. Docker is useful for backend Linux verification and an optional isolated API service. Electron, Windows terminal behavior, and native Antigravity integration retain their own verification lanes.

| Target | Included capabilities | Boundaries |
| --- | --- | --- |
| `test` | Go 1.26.8, Git, POSIX shell, GCC/build tools, downloaded module dependencies, protocol schemas and test fixtures | Container-owned source/home/temp/cache; CGO race tests available; no native provider credentials or desktop |
| `build` | Static daemon and CLI compilation | `CGO_ENABLED=0`; target follows the image platform rather than forcing amd64 |
| `runtime` (default) | Backend API, SQLite storage, Git worktree commands, POSIX shell, curl, CA certificates | Provider CLIs, Antigravity SDK/session setup, project build tools, SSH client and GitHub CLI are absent |

The module currently declares Go 1.25.3. The container's explicitly selected newer compiler is Go 1.26.8; native Windows verification used Go 1.26.7. Those are separate environments. The official Golang image source lists 1.26.8 with a bookworm variant: [Docker library source](https://github.com/docker-library/golang/blob/master/versions.json). Patch versions can be overridden with `--build-arg GO_VERSION=...`; a different compiler requires its own verification. Image tags and Debian package indexes are not immutable digest pins, so this is a repeatable test recipe, not a byte-for-byte hermetic build.

## Linux test commands

Run from the repository root:

```powershell
docker build --target test -f ops/docker/Dockerfile.backend -t orchestra-backend-test:local .
docker run --rm --init --network none orchestra-backend-test:local fixture
docker run --rm --init --network none orchestra-backend-test:local race
docker run --rm --init --network none orchestra-backend-test:local unit
```

`fixture` runs `internal/testsupport/...` and `cmd/ade-fixture` tests. `race` runs the complete backend suite with `go test -race ./...`, including agent protocols, Studio, tracker persistence and execution helpers. `unit` runs the complete backend package suite. `all`, the default command, runs unit then race, stopping on failure. All commands return nonzero when a test or required executable fails. The race lane covers every backend package rather than treating focused fixture tests as whole-backend evidence.

The Compose equivalent selects the test target and blocks runtime network access:

```powershell
docker compose -f ops/docker/compose.test.yml build
docker compose -f ops/docker/compose.test.yml run --rm backend-tests fixture
docker compose -f ops/docker/compose.test.yml run --rm backend-tests
```

Module and image downloads occur during the build. Test execution uses cached modules with `GOPROXY=off`, `GOSUMDB=off`, `GOTOOLCHAIN=local`, `GOFLAGS=-mod=readonly`, and `CGO_ENABLED=1`. No host home, provider configuration, Git checkout, database, Docker socket, or source-directory bind mount is configured. Fixture tests create their own Git repositories and isolated homes inside the container. The Dockerfile-specific ignore file excludes host binaries, databases, logs and credential/config directories from source copies.

The image intentionally excludes the host checkout's `.git` metadata. Tests for the evidence producer use their own disposable source repositories. Running `ade-fixture --source-root /src` cannot certify the Orchestra checkout in this image: `/src` is not a Git checkout and no equivalent source-identity claim is supplied. Persisted current-checkout reporting remains the separately documented [ADE evidence lane](../testing/ade-evidence-handoff-2026-10-03.md).

## Optional API service

The backend binds `0.0.0.0` inside its container, so it requires an explicitly supplied `ORCHESTRA_API_TOKEN`. The Compose file publishes only to host loopback and uses a Docker-managed named volume for `/data`. On PowerShell, generate a session token without saving it in source:

```powershell
$env:ORCHESTRA_API_TOKEN = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$env:ORCHESTRA_DOCKER_PORT = '49010'
docker compose -f ops/docker/compose.backend.yml up --build -d --wait
docker compose -f ops/docker/compose.backend.yml ps
Invoke-RestMethod http://127.0.0.1:49010/healthz
docker compose -f ops/docker/compose.backend.yml down
```

Use the same token when configuring an API client. Do not print or commit a real token. `down` preserves the named data volume; remove a disposable volume only when its deletion is intended. The native desktop's configured backend endpoint remains a separate choice; starting this service does not automatically attach Electron to it.

Runtime paths are `HOME=/data/home`, `ORCHESTRA_WORKSPACE_ROOT=/data/workspaces`, and `ORCHESTRA_WORKTREE_ROOT=/data/worktrees`, owned by UID/GID 10001. The warehouse DB is under `/data/workspaces/.orchestra`. Neither the Compose service nor the test service mounts developer provider settings or the host Docker socket. An explicitly enabled provider still needs a compatible runtime image, its supported configuration and authentication, and separate verified launch/chat/cancellation behavior. Git remote access and project verification tools need explicit setup; Git/sh presence alone does not establish a working agent lifecycle.

The health check calls the public live `/healthz` endpoint using the configured port. It proves API responsiveness, not provider readiness or task E2E reliability. The previous `orchestra check` health check validated static configuration and required a workflow file; it did not inspect the running daemon. `orchestrad` starts the service with no positional command, while `orchestra` remains the auxiliary CLI.

## Publishing compatibility and evidence

The existing `orchestra-container-publish` workflow continues to use this Dockerfile and its default final runtime target, preserving `ghcr.io/<owner>/orchestra-backend` coordinates and the daemon entrypoint. It does not publish the test image. No registry publishing is part of local setup verification.

The [container handoff](../testing/ade-docker-handoff-2026-10-04.md) records reference inspection, actual Docker build/test/startup results, image identities, and any remaining failures. Container results are Linux evidence only; they do not replace Windows native/Electron/provider checks.
