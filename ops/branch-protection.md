# Branch Protection Settings

Recommended branch protection rules for the `main` branch.

## Required Status Checks

Enable **Require status checks to pass before merging** with these checks:

| Check | Workflow | Purpose |
|---|---|---|
| `backend-tests` | `orchestra-backend` | Go fmt, vet, unit/integration tests |
| `backend-race-tests` | `orchestra-backend` | Race condition detection |
| `naming-guard` | `orchestra-backend` | Prevent legacy Symphony naming |
| `desktop-smoke` | `orchestra-desktop-smoke` | Desktop release gate (tests, typecheck, build, smoke ops) |
| `make-all` | `make-all` | TUI tests and build |
| `validate-pr-description` | `pr-description-lint` | PR body format validation |

Enable **Require branches to be up to date before merging** to prevent merge skew.

## Pull Request Reviews

- **Required approving reviews:** 1
- **Dismiss stale pull request approvals when new commits are pushed:** Yes
- **Require review from Code Owners:** Yes (see `.github/CODEOWNERS`)

## Branch Restrictions

- **Restrict who can push to matching branches:** Limit direct pushes to repository admins only.
- **Do not allow force pushes.**
- **Do not allow deletions.**

## Additional Settings

- **Require signed commits:** Optional — enable if contributors have GPG keys configured.
- **Require linear history:** Recommended — enforces squash or rebase merges, keeps history clean.
- **Include administrators:** Yes — admins should follow the same rules.

## Applying These Settings

1. Go to **Settings > Branches > Add branch protection rule**
2. Set **Branch name pattern** to `main`
3. Configure each setting as described above
4. Save changes

Alternatively, use the GitHub CLI:

```bash
gh api repos/{owner}/{repo}/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["backend-tests","backend-race-tests","naming-guard","desktop-smoke","make-all","validate-pr-description"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"dismiss_stale_reviews":true,"require_code_owner_reviews":true,"required_approving_review_count":1}' \
  --field restrictions=null
```
