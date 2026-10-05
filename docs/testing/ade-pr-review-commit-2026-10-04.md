# Review submissions use the displayed commit

## Reference observations and adaptation

T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`,
`apps/server/src/orchestration-v2/ThreadPullRequestService.ts`, checks repository
identity and workspace snapshots around PR observation. Orca
`3284b4c70c901402831bb4ccc5576ea083d2e5ae`,
`src/main/ipc/github-pr-review-handlers.ts` requires a nonempty PR head SHA and
`src/main/github/client/create/add-pr-review-comment.ts` passes `commit_id` to
GitHub. Both source boundaries were inspected; reference runtime/suites were not
executed. No reference source was copied.

Orchestra applies that identity pattern to whole-PR reviews, rather than Orca's
inline-comment boundary. The renderer submits the loaded snapshot SHA, not stale
parent props. The API validates the full SHA and supported submitted events before
project lookup or token refresh. The hosted response must confirm a positive
review ID, the same commit and the requested submitted state. Missing/malformed or
inconsistent confirmations remain uncertain; the UI preserves the review text
and prevents immediate blind resubmission.

[GitHub's review API](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request)
defaults an omitted commit to the latest commit. Explicit commit anchoring avoids
approving unseen newer code. This does not atomically require the branch to remain
unchanged while submitting; a later commit may make the anchored review stale.
The existing expected-head merge guard remains separate.

## Verification boundary

Focused native API review/merge tests passed. Local HTTP fixtures confirm all
three submitted review events, exact commit/body payloads and one POST without
automatic retry. Wrong commit, pending state, missing identity, malformed reply,
host failure and a connection dropped after receiving the POST return an
uncertain result; explicit host rejection remains a failure. Invalid input is
rejected before database/token/network activity.

Renderer/client regressions verify snapshot SHA rather than stale props, the
actual request payload and preserved draft/disabled actions after uncertainty.
The full desktop suite passed (85 files, 574 tests, two existing skips), as did
typecheck and production build. Full Linux backend `go test -race ./...` passed.
Hosted CI remains a merge gate. No hosted review was posted by these fixtures,
and the issue-to-provider-to-review lifecycle is not claimed complete. Repository
configuration revision fencing and actual hosted-provider canaries remain open.

Review additionally identified incomplete response validation: decoding one JSON
value could accept a matching confirmation followed by malformed bytes or a
truncated declared body. The utility now reads the complete response with an
8 MiB bound, checks read errors and unmarshals exactly one JSON document. Both
new native API fixtures fail against an overlay of the previous decoder (false
HTTP 200) and pass with the correction (uncertain HTTP 409, exactly one POST).
The overlay did not modify the working source.
