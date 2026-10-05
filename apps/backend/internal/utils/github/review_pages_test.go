package github

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestReviewPaginationDoesNotSilentlyDropComments(t *testing.T) {
	for _, resource := range []string{"reviews", "comments"} {
		t.Run(resource, func(t *testing.T) {
			calls := 0
			fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/repos/owner/repo/pulls/7/"+resource || r.URL.Query().Get("per_page") != "100" {
					t.Errorf("wrong target: %s", r.URL)
				}
				if r.Header.Get("Authorization") != "token fixture-token" {
					t.Error("missing authorization")
				}
				batch := make([]map[string]any, 0)
				if r.URL.Query().Get("page") == "1" {
					for i := 1; i <= 100; i++ {
						batch = append(batch, map[string]any{"id": i})
					}
				} else {
					batch = append(batch, map[string]any{"id": 101})
				}
				// A hostile Link must never become a token-bearing request target.
				w.Header().Set("Link", "<https://attacker.invalid/comments>; rel=next")
				json.NewEncoder(w).Encode(batch)
			}))
			defer fixture.Close()
			target, _ := url.Parse(fixture.URL)
			prior := http.DefaultClient
			http.DefaultClient = &http.Client{Transport: &mergeFixtureTransport{target: target}}
			t.Cleanup(func() { http.DefaultClient = prior })
			items, err := listReviewPages(context.Background(), "owner", "repo", "fixture-token", 7, resource)
			if err != nil || len(items) != 101 || calls != 2 {
				t.Fatalf("pagination: %d items, %d calls, %v", len(items), calls, err)
			}
		})
	}
}

func TestReviewPaginationFailureDoesNotReturnPartialSuccess(t *testing.T) {
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("page") == "2" {
			w.WriteHeader(503)
			return
		}
		batch := make([]map[string]any, 100)
		for i := range batch {
			batch[i] = map[string]any{"id": i}
		}
		json.NewEncoder(w).Encode(batch)
	}))
	defer fixture.Close()
	target, _ := url.Parse(fixture.URL)
	prior := http.DefaultClient
	http.DefaultClient = &http.Client{Transport: &mergeFixtureTransport{target: target}}
	t.Cleanup(func() { http.DefaultClient = prior })
	items, err := ListPRComments(context.Background(), "owner", "repo", "fixture-token", 7)
	if err == nil || items != nil {
		t.Fatalf("partial discussion reported success: %v, %v", items, err)
	}
}
