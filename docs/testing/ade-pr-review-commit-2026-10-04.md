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

Focused native API review/merge tests and 35 renderer/client tests passed during
implementation. Additional API response/uncertain-state tests, full suites and
hosted CI remain pending for this package. No hosted review was posted by these
fixtures, and the issue-to-provider-to-review lifecycle is not claimed complete.
