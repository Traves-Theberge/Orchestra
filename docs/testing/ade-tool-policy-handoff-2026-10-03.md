# Task disabled-tool enforcement

This package 03 slice makes task `DisabledTools` an execution restriction for Orchestra-owned tools. Previously a disabled name was hidden from advertised specs but a forged call could still enter MCP or tracker routing.

## Reference receipt

Before implementation, inspected the package 03 plan and pinned T3 Code `737993303d36e10674c54b95e5bd3826682c99c7` [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts). Its typed runtime policy and request-response boundaries distinguish provider-native policy from application handling. The later [ChatComposer.tsx](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/chat/ChatComposer.tsx) inspection confirmed separate selection, approval and submission paths; it supplies no evidence that hiding an Orchestra tool disables execution.

Before implementation, inspected Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae` [agent-project-model-override.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts). It explicitly distinguishes configuration presence from knowledge of the effective native model. Adaptation: distinguish advertised tool availability from actual execution enforcement, and verify a forged call at the application executor boundary. No equivalent Orchestra-owned disabled-tool guard was established in these inspected sources. This narrowly scoped guard is an independent design rather than a copied reference implementation. Neither reference was run as part of this slice.

## Implementation

`apps/backend/internal/app/tool_policy.go` freezes the disabled names for the current dispatch and uses the same lowercased, whitespace-trimmed comparison for spec filtering and execution denial. `run.go` uses that policy for both tracker and MCP tool lists and wraps MCP/fallback routing with the denial check.

A denied call returns the existing `success: false` / `contentItems` / `inputText` tool-result envelope. Its JSON error contains `code: TOOL_DISABLED`, a message, and the requested tool name with surrounding whitespace removed. It never invokes the MCP route or fallback executor. Permitted calls preserve current context, arguments, results and MCP-error fallback behavior.

Boundary audit: MCP advertises `server_tool` and routes by the first underscore; tracker tools use their exact names and trim surrounding whitespace. The inspected dispatch implementations support no alternative namespace alias for the same tool. Disabled MCP names must be the fully advertised names; a different server's same bare tool name is a distinct tool. This slice preserves current MCP naming/routing, including the existing limitations for underscore-containing server names; it does not invent new aliases.

## Verification

`go test ./internal/app -v` passed on Windows amd64 in 11.855 seconds, including the three new policy tests; `go vet ./internal/app` passed.

- Denied tracker/MCP names, mixed case and surrounding whitespace caused zero MCP and fallback calls. Advertisement used the same deny comparison. Mutating the original disabled list after constructing the policy did not change its restriction.
- Permitted MCP calls preserved their original response. MCP routing errors retained tracker fallback; plain fallback requests preserved context and arguments.
- The real registry and recording runner forged two calls omitted from its advertised specs. Both received typed denial results; the one permitted tracker request executed. Route counts and the unchanged disposable task Git checkout independently agreed that the denied calls had no executor-side effect.

The first focused run found a test expectation incorrectly assuming the echoed error name was lowercased. The assertion was corrected to preserve the requested name's case, matching the intended result convention; the full package then passed.

This is executor-boundary simulation, not a real-provider or API/UI lifecycle canary. It does not restrict native provider filesystem/shell tools, configure approvals or sandboxing, repair configuration persistence, or certify the unconditional `AutoApprove` behavior. Those package 03 gates remain open.
