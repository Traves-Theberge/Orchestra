# Orchestra Tracker Contract v1

Status: Draft v1

Purpose: Define the backend tracker interface Orchestra requires, independent of any specific vendor implementation.

## Scope

This contract is used by backend orchestration runtime now.

UI scope note:

- Electron React/Vite interface implementation is deferred to interface phase.
- Tracker contract is backend-first and UI-agnostic.

## Canonical Issue Shape

Required fields:

1. `id` (stable opaque id)
2. `identifier` (human-readable id, ex: `ORC-42`)
3. `title`
4. `state`

Optional fields may be added but must not break this base contract.

## Required Operations

### 1) Fetch Candidate Issues

Input:

- `active_states[]`

Output:

- `issues[]` matching active states

Guarantees:

- Must return deterministic ordering.
- Must avoid duplicate issues.

### 2) Fetch Issue States By IDs

Input:

- `issue_ids[]`

Output:

- `map[issue_id]state`

Guarantees:

- Supports large sets (pagination/chunking internally).
- Missing ids may be omitted from map.

### 3) Fetch Issues By States

Input:

- `states[]`

Output:

- `issues[]` in requested states.

Use:

- Startup cleanup and terminal-state workspace cleanup flows.

## Error Semantics

Implementations must return explicit, actionable errors for:

1. Authentication failures.
2. Authorization failures.
3. Timeout/network failures.
4. Rate-limit failures.
5. Invalid response shape/parsing failures.

## Performance Requirements

1. State refresh over `N > 50` IDs must still complete with full coverage.
2. Poll operations should complete within configured refresh interval budget.

## Conformance Tests

Any tracker implementation (including future clone) must pass:

1. Candidate query filtering tests.
2. State refresh completeness tests (including `N > 50`).
3. Terminal-state query tests.
4. Retry/reconciliation integration tests with orchestrator.
