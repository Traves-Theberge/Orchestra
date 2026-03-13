package github

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type PRRequest struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Head  string `json:"head"`
	Base  string `json:"base"`
}

type PRResponse struct {
	HTMLURL string `json:"html_url"`
	Number  int    `json:"number"`
}

func CreatePullRequest(ctx context.Context, owner, repo, token string, pr PRRequest) (*PRResponse, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls", owner, repo)

	body, err := json.Marshal(pr)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("github api returned status %d", resp.StatusCode)
	}

	var prResp PRResponse
	if err := json.NewDecoder(resp.Body).Decode(&prResp); err != nil {
		return nil, err
	}

	return &prResp, nil
}
