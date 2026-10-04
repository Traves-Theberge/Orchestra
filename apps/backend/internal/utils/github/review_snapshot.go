package github

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

var ErrReviewSnapshotChanged = errors.New("pull request changed while loading; refresh and review again")

type ReviewSnapshot struct {
	PR   PullRequest `json:"pr"`
	Diff string      `json:"diff"`
}

func snapshotSHA(value string) bool {
	if len(value) != 40 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

// GetReviewSnapshot reads a diff pinned to immutable commits, then checks that
// the PR still names those commits. The merge request must separately send SHA.
func GetReviewSnapshot(ctx context.Context, owner, repo, token string, number int) (*ReviewSnapshot, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	baseURL := fmt.Sprintf("https://api.github.com/repos/%s/%s", url.PathEscape(owner), url.PathEscape(repo))
	read := func(path, accept string) ([]byte, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", baseURL+path, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "token "+token)
		req.Header.Set("Accept", accept)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, apiError(resp)
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024+1))
		if err != nil {
			return nil, err
		}
		if len(data) > 8*1024*1024 {
			return nil, errors.New("review snapshot exceeds 8 MiB; use another review surface")
		}
		return data, nil
	}
	detail := func() (*PullRequest, error) {
		data, err := read(fmt.Sprintf("/pulls/%d", number), "application/vnd.github+json")
		if err != nil {
			return nil, err
		}
		var pr PullRequest
		if err := json.Unmarshal(data, &pr); err != nil {
			return nil, err
		}
		if pr.Number != number || !snapshotSHA(pr.Head.SHA) || !snapshotSHA(pr.Base.SHA) {
			return nil, errors.New("GitHub review detail missing expected PR identity or commit SHAs")
		}
		return &pr, nil
	}
	before, err := detail()
	if err != nil {
		return nil, err
	}
	diff, err := read("/compare/"+before.Base.SHA+"..."+before.Head.SHA, "application/vnd.github.diff")
	if err != nil {
		return nil, err
	}
	after, err := detail()
	if err != nil {
		return nil, err
	}
	if before.Head.SHA != after.Head.SHA || before.Base.SHA != after.Base.SHA || before.State != after.State || before.Draft != after.Draft {
		return nil, ErrReviewSnapshotChanged
	}
	return &ReviewSnapshot{PR: *after, Diff: string(diff)}, nil
}
