# Remote execution and workspace ownership

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 08 and C2; 09 for remote DAG claims. Outcome: native chat/CLI controls a proven remote task without confusing local files, credentials, ports or provider sessions with those on its owning environment.

## Files and boundaries

Existing: runtime-target types, Tailscale/Kubernetes/Unsandbox code, backend connection profiles, workspace guards, API auth, Electron filesystem bridge, browser and terminal panes; task environment/context contracts and effective config.

Proposed: environment descriptor/capability negotiation, remote file/terminal/preview APIs where absent, remote process/config provisioning and integration fixtures. Validate one remote target before broadening to every existing transport.

## 10.1 Establish environment identity and capabilities

- [ ] Give each environment a stable ID and advertised API/provider/session capabilities. Bind tasks, runs, credentials and file paths to it.
- [ ] Define connection/auth ownership and version compatibility. An unavailable environment cannot fall back to the local project with the same name.
- [ ] Show environment selection and identity in chat, board, workspace and CLI output.
- [ ] Test two environments with identical repo/project names and incompatible capability versions.

## 10.2 Resolve remote configuration and files

- [ ] Resolve effective configuration on the owning backend using its installed/authenticated provider instances. Local global settings do not silently become remote settings.
- [ ] Replace local filesystem IPC for remote contexts with environment-owned APIs. Validate path/checkout ownership server-side.
- [ ] Stage authorized attachments on the remote environment and track their identities; exclude unintended local credentials.
- [ ] Test remote model/config availability, missing repo, ignored settings and denied file access.

## 10.3 Own remote processes and previews

- [ ] Create/reattach remote agent/terminal sessions under the recovery contract; cancellation must reach the owned remote process tree.
- [ ] Allocate preview ports and a declared forwarding/network identity per remote task. Browser UI must reveal which environment serves the page.
- [ ] Define upload/download and remote artifact handling. Do not assume local localhost refers to a remote dev server.
- [ ] Exercise connection loss during execution, tool requests, finalization and preview loading.

## 10.4 Prove one target then expand

- [ ] Select one transport with an available disposable host/container and configured authorization. Record unavailable infrastructure as blocked.
- [ ] Run configuration, native multi-turn chat, execution, verification, PR review/link persistence and cancel/reconnect scenarios there.
- [ ] Verify no mutation reaches the local repo when the task is remote and no local account is silently used.
- [ ] Add independent evidence for subsequent Tailscale/Kubernetes/Unsandbox targets and OS/provider combinations. Presence of runner code does not earn support.

## Validation and exit

- [ ] Remote task context, effective config, process ownership and actual file effects agree.
- [ ] Disconnect/reconnect does not duplicate workers or route actions to local paths.
- [ ] Remote cancel/finalization failures remain visible and recoverable.
- [ ] Native chat, CLI and workspace agree on environment identity and capabilities.

Handoff: supported target matrix, environment protocol/forwarding rules and remote recovery evidence. Do not expose a network listener without the existing authentication controls and a tested authorization boundary.
