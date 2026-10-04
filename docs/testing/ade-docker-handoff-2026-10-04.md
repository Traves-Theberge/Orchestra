# ADE Docker setup and Linux verification handoff

## Scope and reference receipt

This slice fixes the optional backend image and adds a separate Linux verification target. It preserves the existing default runtime publishing path and the Kanban/native desktop architecture. No image was published and no host provider configuration, credentials, home directory or Docker socket was mounted.

Before implementation, inspected the required pinned registry and both source patterns:

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts). Typed provider policies/events and runtime request boundaries distinguish a runtime from its provider capabilities. Orchestra adapts this through explicit image capabilities and limits: Git/sh/API support does not establish native provider launch or session readiness.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [worker-list-run-scope.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/worker-list-run-scope.test.ts). Tests make observation scope explicit. Orchestra reports the Linux backend scope separately from Windows/Electron/provider verification and uses owned test roots/resources.

Neither inspected excerpt supplies an equivalent Docker implementation. This is an independent Go/Debian adaptation of the capability and observation boundaries, not copied source. Reference applications were not run; their source/tests do not certify these Orchestra results.

## Changed files and behavior

- `ops/docker/Dockerfile.backend`: Go 1.26.8 bookworm toolchain; explicit non-root CGO test target; static build target; final non-root Debian API image with Git, shell, curl and CA certificates. The live health check calls `/healthz`; the previous static CLI `check` did not inspect the daemon. `orchestrad` starts directly, without a `start` argument.
- `ops/docker/Dockerfile.backend.dockerignore`: selected backend/schema/fixture context, excluding host binaries, databases, logs, `.git` and provider config directories. An initial overly broad binary exclusion removed command source directories; it was corrected before the successful builds.
- `ops/docker/test-backend.sh`: `unit`, `race`, `fixture`, and default `all` lanes with executable/CGO prerequisites and nonzero failure propagation. `race` covers the full backend suite.
- `ops/docker/compose.test.yml`: image-owned tests, no mounts, no execution network. `ops/docker/compose.backend.yml`: explicitly required API token, host-loopback publishing and a Docker-managed `/data` volume.
- [Docker operations guide](../operations/docker.md): commands, capabilities, persistence and verification boundaries.

The module declares Go 1.25.3; Linux verification used Go 1.26.8, while native Windows verification uses Go 1.26.7. Runtime provider CLIs, project toolchains, SSH and GitHub CLI are absent. Image tags/package indexes remain mutable; this is not a byte-hermetic build. Host `.git` is intentionally excluded, so `ade-fixture --source-root /src` cannot certify the Orchestra checkout in this image. Fixture producer tests use disposable repositories.

## Executed evidence

Docker CLI 29.7.2, Compose v5.4.0, Linux/amd64 Docker daemon. Final test image: `sha256:a6a11336fbbeb867acc35e057fbf3efaaba4d80a271b1231e937e8eb7008b039`. Final runtime image: `sha256:1069692703f2a4dd69b37bc0258fd60b8f3253bcfd24242259c0d50bd185c4b1`. These fresh builds include final API metadata projection and command-runner fixes.

| Check | Actual result |
| --- | --- |
| Build test and default runtime targets | Both passed |
| Both Compose configurations, `config --quiet` | Passed; runtime used a disposable explicit token |
| Full `go test ./...` | Passed all backend packages; API 61.387s, agents 1.857s, app 4.358s |
| Full `go test -race ./...` | Passed all backend packages, including agents, Studio and tracker; API 116.368s, agents 3.617s, app 14.596s |
| Focused `go test ./internal/agents -run TestCommandRunner -count=1` | Passed 1.454s |
| Focused runner suite with `-race -count=1 -v` | Passed 2.508s, including inherited-pipe bounded exit |
| Fast-exit gated regression with `-race -count=20 -v` | Passed 2.555s |
| Final runtime default startup and live health | Passed with no positional command; UID/GID 10001; healthy; ephemeral host loopback port 52015 |
| Final runtime real Git/worktree/shell/SQLite/authenticated API smoke | Passed: disposable Git repo/local identity/commit/worktree, shell file write, warehouse DB present and authenticated `/api/v1/state` response |

Commands were run through Docker `exec` in a fresh image-owned test container with `--network none` and only a Docker-managed Go cache volume mounted at `/tmp/orchestra-go-cache`. Full `all` exited zero. Cached race packages are explicitly reported by Go; changed packages ran freshly. Runtime had only an owned disposable `/data` volume and no host bind mounts. Native audit ports 4011/5173 were left untouched.

The first complete Linux unit and race runs failed agents assertions because the old command runner could lose final stdout events. A meaningful regression check copied only the new gated test into a disposable old-image container: it failed with `error=nil`, `output="warmup"`. The agent owner fixed stream drain ordering and bounded inherited pipes; the fresh-image results above passed. The earlier failing runs remain historical evidence, not green results. No race detector warning was observed in those failed runs, but assertion failures still made them unsuccessful.

Diagnostic artifacts are outside the repository at `C:\Users\trave\AppData\Local\Orchestra\diagnostics\docker-8254ea288f31477a86d8d5123be6bd36`: `test-build-final.txt`, `runtime-build-fixed.txt`, `all-final.txt`, `agents-unit-final.txt`, `agents-race-final.txt`, `agents-repeat-final.txt`, `regression-old.txt`, and `runtime-smoke-final.txt`. PowerShell renders Git's informational stderr as `NativeCommandError` in smoke logs; Docker/process exit status and assertions passed. Owned scratch containers/data/cache volumes are removed after verification; locally built images and logs remain available.

## Limits

These are Linux backend unit/race and runtime prerequisite/API checks, not UI-to-provider-to-PR E2E evidence. No real provider/network call, PR publication or production commit was performed; Git commits are fixture-local. Windows security policy, native terminal behavior, Electron and Antigravity configuration/session compatibility require their own evidence. Reference source and passing tests cannot establish whole-application reliability.
