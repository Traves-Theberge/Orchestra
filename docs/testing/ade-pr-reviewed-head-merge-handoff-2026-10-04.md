# Reviewed-head merge guard

Scope: `api/projects.go` PostPRMerge, `utils/github/github.go` merge request/utility plus PR head/base SHA decoding, and focused fixture tests. The parent owns the renderer's coherent review snapshot and client/UI calls. Other API handlers, provider/global configuration and the live native audit app are untouched.

## Reference receipt

The mandatory [pinned registry](../superpowers/plans/ade-2026-10-03/reference-patterns.md) and relevant source/tests were inspected before this implementation; the preceding [PR audit](ade-pr-review-audit-2026-10-04.md) contains the fuller source review:

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: [ThreadPullRequestService.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ThreadPullRequestService.ts) and [tests](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ThreadPullRequestService.test.ts) guard repository/project/worktree state when applying discoveries. [RunFinalizationService.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/RunFinalizationService.ts) and its [tests](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/RunFinalizationService.test.ts) prevent refreshing another checkout or a newer active run. Adaptation: identity at mutation time must match the reviewed identity. Deliberate difference: Orchestra enforces merge-head equality using GitHub's atomic merge precondition rather than relying on a local refresh check before a mutation; no reference service or source is copied.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [review documentation](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/docs/site/content/docs/review/github.mdx), [review-head-remote.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/github/review-head-remote.ts) and [tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/github/review-head-remote.test.ts) preserve hosting/remote identity across fork/upstream choices. [merge-actions.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/pull-request-page/actions/merge-actions.ts) surfaces mutation errors and updates merged state only after successful results. Its inspected action does not submit an expected head SHA; that pattern is not claimed as borrowed. Adaptation: preserve meaningful conflict results and do not equate accepted transport with completed merge. Deliberate difference: this slice changes only Orchestra's backend merge contract; confirmation/renderer freshness is parent-owned.
- [GitHub's official merge API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request) specifies `sha` as the head precondition and 409 when it does not match. This supplies the hosted atomicity contract; fixture tests prove Orchestra transmits it correctly, not that a live hosted scenario was exercised.

No reference runtime or hosted mutation was performed. The Kanban/task model remains unchanged. Passing fixture tests cannot establish complete PR-review E2E reliability.

## Contract and behavior

- `PUT /api/v1/projects/{project_id}/github/pulls/{number}/merge` requires `expected_head_sha` containing exactly 40 ASCII hexadecimal characters. Missing, abbreviated, non-hex or wrong-length values return 400 `invalid_expected_head_sha` before project/token/network work. The existing method default is `merge`.
- Exported `ValidMergeHeadSHA` enforces the same contract for direct utility calls. `MergePR` gains a final required `expectedHeadSHA` argument; the only existing production caller is updated. There is no optional unsafe legacy path.
- The hosted PUT body includes `sha` normalized to lowercase alongside `merge_method`. There is no prefetch-only guard or unpinned fallback merge.
- GitHub 409 maps to API 409 `pr_head_changed`, instructing the user to refresh and review new commits before retrying.
- HTTP 200 is successful only if decoded `merged` explicitly equals true. False returns 409 `pr_not_merged`; missing or malformed status produces 502 `github_merge_failed` instead of falsely reporting success. Other hosted failures retain descriptive errors.
- Existing PR Head and Base structs now retain `json:"sha"` for the parent's immutable displayed-diff snapshot flow.

## Verification

Windows `go test ./internal/api ./internal/utils/github -run 'TestPostPRMerge|TestMergePR' -count=1`: passed (API 7.032 seconds; utility 2.829 seconds). Scoped diff check passed.

New tests use local `httptest.Server` fixtures, rewriting hosted URLs to the local fixture through a temporary sequential-test client that is restored after the test. No fixture can contact GitHub or access real credentials. SQLite project metadata contains only a dummy token in a temporary database.

Acceptance covered:

- Missing and invalid expected SHA fail before DB/token/HTTP activity; direct utility callers are also guarded.
- Exactly one hosted PUT targets the configured repository and PR number and contains the displayed head SHA/method. No GET-before-PUT identity check substitutes for the host precondition.
- Host conflict is preserved as actionable API conflict.
- Unchanged head fixture explicitly reports merged=true and succeeds.
- False, missing and malformed result status cannot produce successful merge output.
- Default merge method and uppercase SHA normalization are verified.

Broader final native/Docker unit/race lanes, coherent snapshot/UI behavior, and any independently authorized hosted scenario are parent-owned and are not claimed by these focused results. Review submission commit anchoring and publication identity/finalization gaps from the earlier audit remain separate work.
