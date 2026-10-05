package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Read numbered pages from the same trusted API endpoint, never a Link URL
// supplied by a response. An exhausted budget fails rather than presenting a
// partial discussion as complete.
func listReviewPages(ctx context.Context, owner, repo, token string, number int, resource string) ([]map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	items := make([]map[string]any, 0)
	for page := 1; page <= 20; page++ {
		url := fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls/%d/%s?per_page=100&page=%d", owner, repo, number, resource, page)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "token "+token)
		req.Header.Set("Accept", "application/vnd.github.v3+json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			err = apiError(resp)
			resp.Body.Close()
			return nil, err
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024+1))
		resp.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if len(body) > 2*1024*1024 {
			return nil, fmt.Errorf("GitHub %s page exceeded response limit", resource)
		}
		var batch []map[string]any
		if err := json.Unmarshal(body, &batch); err != nil {
			return nil, err
		}
		items = append(items, batch...)
		if len(batch) < 100 {
			return items, nil
		}
	}
	return nil, fmt.Errorf("GitHub %s exceeds 2000 entries; open GitHub to inspect the complete discussion", resource)
}
